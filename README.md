# IBM Cloud Code Engine - Integrate Cloud Object Storage and PostgreSQL through a job and an event subscription

This sample demonstrates how to read CSV files hosted on a IBM Cloud Object Storage and save their contents line by line into relational PostgreSQL database.

## Prerequisites

Make sure the following [IBM Cloud CLI](https://cloud.ibm.com/docs/cli/reference/ibmcloud?topic=cloud-cli-getting-started) and the following list of plugins are installed
- `ibmcloud plugin install code-engine`
- `ibmcloud plugin install cloud-object-storage`

Install `jq`. On MacOS, you can use following [brew formulae](https://formulae.brew.sh/formula/jq) to do a `brew install jq`.
## CLI Setup

Login to IBM Cloud via the CLI
```
ibmcloud login 
```

Target the `ca-tor` region:
```
export REGION=ca-tor
ibmcloud -r $REGION
```

Create the project:
```
ibmcloud code-engine project create -n ce-objectstorage-to-sql
```

Store the project guid:
```
export CE_ID=$(ibmcloud ce project current -o json | jq -r .guid)
```

Create the job:
```
ibmcloud code-engine job create \
    --name csv-to-sql \
    --source ./ \
    --retrylimit 0 \
    --wait
```

Create the COS instance:
```
ibmcloud resource service-instance-create csv-to-sql-cos cloud-object-storage standard global
```

Store the COS CRN:
```
export COS_ID=$(ibmcloud resource service-instance csv-to-sql-cos --output json | jq -r '.[0] | .id')
```

Create an authorization policy to allow the Code Engine project receive events from COS:
```
ibmcloud iam authorization-policy-create codeengine cloud-object-storage \
    "Notifications Manager" \
    --source-service-instance-id $CE_ID \
    --target-service-instance-id $COS_ID
```

Create a COS bucket:
```
ibmcloud cos config crn --crn $COS_ID --force
ibmcloud cos config auth --method IAM
ibmcloud cos config region --region $REGION
ibmcloud cos config endpoint-url --url s3.$REGION.cloud-object-storage.appdomain.cloud
export BUCKET=$CE_ID-csv-to-sql-2
ibmcloud cos bucket-create \
    --bucket $BUCKET
```

Update the job by adding a binding to the COS instance:
```
ibmcloud code-engine job bind \
    --name csv-to-sql \
    --service-instance csv-to-sql-cos
```

Create the subscription for all COS events:
```
ibmcloud ce sub cos create \
    --name coswatch \
    --bucket $BUCKET \
    --destination csv-to-sql \
    --destination-type job
```

Create a PostgreSQL service instance:
```
ibmcloud resource service-instance-create csv-to-sql-postgresql databases-for-postgresql standard $REGION -p \
 '{
  "members_cpu_allocation_count": "0 cores",
  "members_disk_allocation_mb": "10240MB",
  "members_members_allocation_count": 2,
  "members_memory_allocation_mb": "2048MB",
  "service-endpoints": "public",
  "version": "12"
}'
```

Update the job by adding a binding to the PostgreSQL instance:
```
ibmcloud code-engine job bind \
    --name csv-to-sql \
    --service-instance csv-to-sql-postgresql
```

Upload a CSV file to COS, to initate an event that leads to a job execution:
```
ibmcloud cos object-put \
    --bucket $BUCKET \
    --key users.csv \
    --body ./samples/users.csv \
    --content-type text/csv
```

List all jobs to determine the one, that processes the COS bucket update:
```
ibmcloud code-engine jobrun list \
    --job csv-to-sql \
    --sort-by age
```

Inspect the job execution by opening the logs:
```
ibmcloud code-engine jobrun logs \
    --name <jobrun-name>
```

Or do the two commands in one, using this one-liner:
```
jobrunname=$(ibmcloud ce jr list -j csv-to-sql -s age -o json | jq -r '.items[0] | .metadata.name') && ibmcloud ce jr logs -n $jobrunname -f
```