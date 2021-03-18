# sqs-reader: AWS SQS queue reader for Typescript

[![npm](https://img.shields.io/npm/v/sqs-reader)](https://www.npmjs.com/package/sqs-reader)
[![CircleCI](https://img.shields.io/circleci/build/github/trevorr/sqs-reader)](https://circleci.com/gh/trevorr/sqs-reader)
[![Coverage Status](https://coveralls.io/repos/github/trevorr/sqs-reader/badge.svg?branch=master)](https://coveralls.io/github/trevorr/sqs-reader?branch=master)

A small, simple, robust asynchronous queue reader for [Amazon Simple Queue Service (SQS)](https://aws.amazon.com/sqs/) written in Typescript.

## Features

* Configurable exponential delay between empty receive attempts to limit polling costs when idle
* Supports immediate abort of receive/delay for graceful shutdown
* Abstract logging mechanism uses console by default but can easily use frameworks like [Winston](https://github.com/winstonjs/winston)

## Installation

```sh
npm install sqs-reader
```

## Usage

```ts
import { SQSReader } from 'sqs-reader';

const { AWS_SQS_INDEX_QUEUE_URL } = process.env;

if (!AWS_SQS_INDEX_QUEUE_URL) {
  throw new Error('AWS_SQS_INDEX_QUEUE_URL is not configured');
}

const queueReader = new SQSReader(AWS_SQS_INDEX_QUEUE_URL, async (message) => {
  console.log('Received message', message.MessageId);
});

let shuttingDown = false;

async function shutDown(): Promise<void> {
  if (!shuttingDown) {
    shuttingDown = true;
    console.info('Shutting down...');
    setTimeout((): void => {
      console.warn('Timed out waiting for shutdown');
      process.exit(1);
    }, 30000);
    try {
      queueReader.stop();
      await queueReader.join();
    } catch (err) {
      console.warn('Error in queue reader:', err);
    }
    process.exit(0);
  }
}

process.on('SIGINT', shutDown);
process.on('SIGTERM', shutDown);

(async function () {
  queueReader.start();
  await queueReader.join();
  shutDown();
})();

```

## License

`sqs-reader` is available under the [ISC license](LICENSE).
