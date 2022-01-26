import { fail } from 'assert';
import SQS from 'aws-sdk/clients/sqs';
import { AWSError } from 'aws-sdk/lib/error';
import { expect } from 'chai';
import crypto from 'crypto';
import { SQSReader } from '../src';

const { AWS_SQS_INDEX_QUEUE_URL } = process.env;

if (!AWS_SQS_INDEX_QUEUE_URL) {
  throw new Error('AWS_SQS_INDEX_QUEUE_URL is not configured');
}

const sqs = new SQS({ apiVersion: '2012-11-05' });

function makeBarrier(count = 2) {
  let calls = 0;
  let resolve: (value: unknown) => void;
  const promise = new Promise((r) => (resolve = r));
  return function barrier() {
    if (++calls === count) {
      resolve(null);
    }
    return promise;
  };
}

describe('SQSReader', function () {
  it('receives a message', async function () {
    const sentBody = crypto.randomBytes(64).toString('base64');

    const barrier = makeBarrier();
    let receivedId;
    let receivedBody;
    const queueReader = new SQSReader(AWS_SQS_INDEX_QUEUE_URL, async (message) => {
      receivedId = message.MessageId;
      receivedBody = message.Body;
      if (receivedBody === sentBody) {
        await barrier();
      } else {
        // ignore unexpected messages in case there is pending junk in the queue
        console.log(`Received unexpected message ${receivedId}: ${receivedBody}`);
      }
    });
    queueReader.start();

    const sendResult = await sqs
      .sendMessage({
        QueueUrl: AWS_SQS_INDEX_QUEUE_URL,
        MessageBody: sentBody,
      })
      .promise();
    const sentId = sendResult.MessageId;

    await barrier();
    queueReader.stop();
    await queueReader.join();

    expect(receivedId).to.equal(sentId);
    expect(receivedBody).to.equal(sentBody);
  });

  it('sleeps when idle', async function () {
    // wait for two sleep cycles to cover next delay calculation
    const barrier = makeBarrier(3);
    const logger = Object.assign(Object.create(console), {
      verbose(message: string): void {
        console.log(message);
        if (/sleep/i.test(message)) {
          barrier();
        }
      },
    });

    const queueReader = new SQSReader(
      AWS_SQS_INDEX_QUEUE_URL,
      async (message) => {
        // ignore unexpected messages in case there is pending junk in the queue
        console.log(`Received unexpected message ${message.MessageId}: ${message.Body}`);
      },
      { waitTimeSeconds: 0, initialIdleDelaySeconds: 0, logger }
    );
    queueReader.start();

    // test redundant start
    queueReader.start();

    await barrier();
    queueReader.stop();
    await queueReader.join();
  });

  it('resumes when idle', async function () {
    const sleepBarrier = makeBarrier(2);
    const logger = Object.assign(Object.create(console), {
      verbose(message: string): void {
        console.log(message);
        if (/sleep/i.test(message)) {
          sleepBarrier();
        }
      },
    });

    const sentBody = crypto.randomBytes(64).toString('base64');

    const receivedBarrier = makeBarrier();
    let receivedId;
    let receivedBody;
    const queueReader = new SQSReader(
      AWS_SQS_INDEX_QUEUE_URL,
      async (message) => {
        receivedId = message.MessageId;
        receivedBody = message.Body;
        if (receivedBody === sentBody) {
          await receivedBarrier();
        } else {
          // ignore unexpected messages in case there is pending junk in the queue
          console.log(`Received unexpected message ${receivedId}: ${receivedBody}`);
        }
      },
      { waitTimeSeconds: 0, initialIdleDelaySeconds: 30, logger }
    );
    queueReader.start();

    // test resume when not sleeping
    queueReader.resume();

    await sleepBarrier();

    const sendResult = await sqs
      .sendMessage({
        QueueUrl: AWS_SQS_INDEX_QUEUE_URL,
        MessageBody: sentBody,
      })
      .promise();
    const sentId = sendResult.MessageId;

    // test resume when sleeping
    queueReader.resume();

    await receivedBarrier();

    queueReader.stop();
    await queueReader.join();

    expect(receivedId).to.equal(sentId);
    expect(receivedBody).to.equal(sentBody);
  });

  it('exits on error', async function () {
    const queueReader = new SQSReader('invalid', async () => {
      fail('never called');
    });
    queueReader.start();
    try {
      await queueReader.join();
      fail('exception expected');
    } catch (e) {
      expect((e as AWSError).code).to.equal('UnknownEndpoint');
    }
  });
});
