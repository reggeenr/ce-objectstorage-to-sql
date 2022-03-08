// library needed to read files from COS
import ibm from 'ibm-cos-sdk';

// library to convert CSV content into a object structure
import csv from 'csv-parser';
import { Readable } from 'stream';

// library to access PostgreSQL
import pg from 'pg';
import pgConnectionString from 'pg-connection-string';

console.info('Starting CSV to SQL conversion ...');

console.log(`CE_SERVICES: '${JSON.stringify(process.env.CE_SERVICES)}'`);

const run = async () => {
  //
  // assess whether the jobrun execution contains information about the COS file that got updated
  if (!process.env.CE_DATA) {
    console.log('< ABORT - job does not contain any event data');
    return process.exit(1);
  }
  const eventData = JSON.parse(process.env.CE_DATA);
  console.log(`eventData: '${JSON.stringify(eventData)}'`);

  //
  // make sure that the event relates to a COS write operation
  if (eventData.operation !== 'Object:Write') {
    console.log(`< ABORT - COS operation '${eventData.operation}' does not match expectations 'Object:Write'`);
    return process.exit(1);
  }
  if (eventData.notification.content_type !== 'text/csv') {
    console.log(
      `< ABORT - COS update did happen on file '${eventData.key}' which is of type '${eventData.notification.content_type}' (expected type 'text/csv')`
    );
    return process.exit(1);
  }
  console.log(`received a COS update event on the CSV file '${eventData.key}' in bucket '${eventData.bucket}'`);

  //
  // make sure that the job is bound to the COS instance that is connected through the event subscription
  if (!process.env.CE_SERVICES) {
    console.log(`< ABORT - job is not bound to any service`);
    return process.exit(1);
  }
  const ceServices = JSON.parse(process.env.CE_SERVICES);
  if (!ceServices['cloud-object-storage']) {
    console.log(`< ABORT - cloud-object-storage binding missing`);
    return process.exit(1);
  }

  //
  // init the COS client
  // see: https://github.com/IBM/ibm-cos-sdk-js
  const endpoint = 'https://s3.ca-tor.cloud-object-storage.appdomain.cloud';
  const serviceInstanceId = ceServices['cloud-object-storage'][0].credentials.resource_instance_id;
  console.log(`Connecting to COS instance '${serviceInstanceId}' via endpoint ${endpoint} ...`);
  const cos = new ibm.S3({
    endpoint,
    apiKeyId: ceServices['cloud-object-storage'][0].credentials.apikey,
    serviceInstanceId,
  });

  //
  // retrieve the COS object that got updated
  console.log(`Retrieving file content of '${eventData.key}' from bucket ${eventData.bucket} ...`);
  const fileContent = await getObjectContent(cos, eventData.bucket, eventData.key);

  //
  // convert CSV to a object structure
  console.log(`Converting CSV data to a data struct ...`);
  const users = await convertCsvToDataStruct(fileContent);
  console.log(`users: ${JSON.stringify(users)}`);

  //
  // Connect to PostgreSQL
  // https://node-postgres.com/
  console.log(`Establishing connection to PostgreSQL database ...`);
  const pgCaCert = Buffer.from(process.env.POSTGRE_CACERT_BASE64, 'base64');
  const pgConnectionString = process.env.POSTGRE_URI;
  const pgClient = await connectDb(pgConnectionString, pgCaCert);

  // Do something meaningful with the data
  // https://github.com/IBM-Cloud/compose-postgresql-helloworld-nodejs/blob/master/server.js
  console.log(`Writing converted CSV data to the PostgreSQL database ...`);
  const insertOperations = [];
  users.forEach((userToAdd) => {
    insertOperations.push(addUser(pgClient, userToAdd.Firstname, userToAdd.Lastname));
  });

  // Wait for all SQL insert operations to finish
  console.log(`Waiting for all SQL INSERT operations to finish ...`);
  Promise.all(insertOperations)
    .then((results) => {
      results.forEach((result, idx) => console.log(`Added ${JSON.stringify(users[idx])} -> ${JSON.stringify(result)}`));
      console.info('COMPLETED');
    })
    .catch((err) => {
      console.error('Failed to add users to the database', err);
      console.info('FAILED');
    });
};
run();

function getObjectContent(cosClient, bucket, key) {
  return cosClient
    .getObject({ Bucket: bucket, Key: key })
    .promise()
    .then((obj) => {
      console.info(`received file`);

      // extract file content
      const fileContent = obj.Body.toString();
      console.info(`file content: '${fileContent}'`);

      return fileContent;
    })
    .catch((err) => {
      console.error(err);
      return undefined;
    });
}

function convertCsvToDataStruct(csvContent) {
  return new Promise((resolve) => {
    // the result to return
    const results = [];

    // create a new readable stream
    var readableStream = new Readable();

    // the CSV parser consumes the stream
    readableStream
      .pipe(csv())
      .on('data', (data) => results.push(data))
      .on('end', () => {
        console.log(`converted CSV data: ${JSON.stringify(results)}`);

        resolve(results);
      });

    // push the CSV file content to the stream
    readableStream.push(csvContent);
    readableStream.push(null); // indicates end-of-file
  });
}

function connectDb(connectionString, caCert) {
  return new Promise((resolve, reject) => {
    const postgreConfig = pgConnectionString.parse(connectionString);

    // Add some ssl
    postgreConfig.ssl = {
      ca: caCert,
    };

    // set up a new client using our config details
    let client = new pg.Client(postgreConfig);

    client.connect((err) => {
      if (err) {
        console.error(`Failed to connect to postgreSQL host '${postgreConfig.host}'`, err);
        return reject(err);
      }

      client.query(
        'CREATE TABLE IF NOT EXISTS users (firstname varchar(256) NOT NULL, lastname varchar(256) NOT NULL)',
        (err, result) => {
          if (err) {
            console.log(`Failed to create PostgreSQL table 'users'`, err);
            return reject(err);
          }
          console.log(
            `Established PostgreSQL client connection to '${postgreConfig.host}' - user table init: ${JSON.stringify(
              result
            )}`
          );
          return resolve(client);
        }
      );
    });
  });
}

function addUser(client, firstName, lastName) {
  return new Promise(function (resolve, reject) {
    const queryText = 'INSERT INTO users(firstname,lastname) VALUES($1, $2)';
    client.query(queryText, [firstName, lastName], function (error, result) {
      if (error) {
        return reject(error);
      }
      return resolve(result);
    });
  });
}
