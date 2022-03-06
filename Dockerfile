
#####################################
## FIRST stage
#####################################
# Use the official lightweight Node.js 16 image.
# https://hub.docker.com/_/node
FROM node:lts-alpine as dependencies

# Create and change to the job directory.
WORKDIR /job-deps

# Copy job dependency manifests to the container image.
# A wildcard is used to ensure both package.json AND package-lock.json are copied.
# Copying this separately prevents re-running npm install on every code change.
COPY package*.json ./

# Install production dependencies.
RUN npm install --only=production

####################################
# SECOND STAGE
# - copy the mandatory files into the fresh image
# - set the start command

# Use the official lightweight Node.js 16 image.
# https://hub.docker.com/_/node
FROM node:lts-alpine

WORKDIR /job

# Copy local code to the container image.
COPY ./src ./

# Copy the dependencies and other project related files
COPY --from=dependencies /job-deps/ ./

CMD [ "npm", "start" ]