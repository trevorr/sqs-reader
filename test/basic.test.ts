import sleep from 'sleep-cancel';
import { SQSReader } from '../src';

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
    // setTimeout((): void => {
    //   console.warn('Timed out waiting for shutdown');
    //   process.exit(1);
    // }, 30000);
    try {
      queueReader.stop();
      await queueReader.join();
    } catch (err) {
      console.warn('Error in queue reader:', err);
    }
    // process.exit(0);
  }
}

process.on('SIGINT', shutDown);
process.on('SIGTERM', shutDown);

(async function () {
  queueReader.start();

  // for automated test only
  await sleep(100);
  queueReader.stop();

  await queueReader.join();
  shutDown();
})();
