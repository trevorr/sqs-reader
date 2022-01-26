import SQS from 'aws-sdk/clients/sqs';
import { AWSError } from 'aws-sdk/lib/error';
import { Request as AWSRequest } from 'aws-sdk/lib/request';
import sleep, { SleepCancelled, SleepResult } from 'sleep-cancel';

export interface Logger {
  verbose(message: string): void;
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface SQSReaderOptions {
  waitTimeSeconds?: number;
  initialIdleDelaySeconds: number;
  maximumIdleDelaySeconds: number;
  logger: Logger;
}

const defaultOptions: SQSReaderOptions = {
  initialIdleDelaySeconds: 5,
  maximumIdleDelaySeconds: 300,
  logger: Object.assign(Object.create(console), { verbose: console.log }),
};

export type SQSMessageCallback = (message: SQS.Message) => Promise<void>;

export class SQSReader {
  private readonly sqs = new SQS({ apiVersion: '2012-11-05' });
  private readonly options: SQSReaderOptions;
  private running = false;
  private receiveRequest?: AWSRequest<SQS.Types.ReceiveMessageResult, AWSError>;
  private receivePromise?: Promise<void>;
  private sleepHandle?: SleepResult;

  public constructor(
    private readonly queueUrl: string,
    private readonly callback: SQSMessageCallback,
    options?: Partial<SQSReaderOptions>
  ) {
    this.options = Object.assign({}, defaultOptions, options);
  }

  public start(): void {
    if (!this.running) {
      this.receivePromise = this.receive();
    }
  }

  public stop(): void {
    this.running = false;
    if (this.receiveRequest) {
      this.receiveRequest.abort();
    }
    if (this.sleepHandle) {
      this.sleepHandle.cancel();
    }
  }

  public async join(): Promise<void> {
    return this.receivePromise;
  }

  private async receive(): Promise<void> {
    const { logger } = this.options;
    logger.debug('Starting receive loop');
    this.running = true;
    let idleDelaySeconds = this.options.initialIdleDelaySeconds;
    while (this.running) {
      try {
        this.receiveRequest = this.sqs.receiveMessage({
          QueueUrl: this.queueUrl,
          WaitTimeSeconds: this.options.waitTimeSeconds,
          MaxNumberOfMessages: 10, // maximum supported
        });
        let result;
        try {
          result = await this.receiveRequest.promise();
        } finally {
          this.receiveRequest = undefined;
        }
        if (result.Messages && result.Messages.length > 0) {
          const handles: string[] = [];
          try {
            for (const message of result.Messages) {
              await this.callback(message);
              /* istanbul ignore else */
              if (message.ReceiptHandle) {
                handles.push(message.ReceiptHandle);
              }
            }
          } finally {
            try {
              await this.sqs
                .deleteMessageBatch({
                  QueueUrl: this.queueUrl,
                  Entries: handles.map((h, i) => ({ Id: String(i), ReceiptHandle: h })),
                })
                .promise();
            } catch (e) {
              /* istanbul ignore next */
              logger.warn(`Failed to delete handles (${handles.join(', ')}): ${getErrorMessage(e)}`);
            }
          }
          idleDelaySeconds = this.options.initialIdleDelaySeconds;
        } /* istanbul ignore else */ else if (this.running) {
          logger.verbose(`Sleeping for ${idleDelaySeconds} seconds while idle`);
          await (this.sleepHandle = sleep(idleDelaySeconds * 1000));
          idleDelaySeconds = Math.min(idleDelaySeconds * 2, this.options.maximumIdleDelaySeconds);
        }
      } catch (e) {
        this.running = false;
        if (e instanceof SleepCancelled) {
          logger.debug('Receive sleep cancelled');
        } else if (isAWSError(e) && e.code === 'RequestAbortedError') {
          logger.debug('Receive request aborted');
        } else {
          logger.info(`Exception in receive loop: ${getErrorMessage(e)}`);
          throw e;
        }
      }
    }
    logger.debug('Receive loop exiting');
  }
}

function getErrorMessage(e: unknown): string {
  /* istanbul ignore else */ 
  if (e instanceof Error) {
    return e.message;
  }
  /* istanbul ignore next */
  if (e && typeof e === 'object') {
    return e.constructor.name;
  }
  /* istanbul ignore next */
  return String(e);
}

function isAWSError(e: unknown): e is AWSError {
  return e instanceof Error && 'code' in e;
}
