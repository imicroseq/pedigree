import axios from 'axios';

import logger from './logger';
import { config } from '@/config';

export enum NOTIFICATION_CATEGORY_ICON {
  INFO = ':information_source:',
  ERROR = ':bang_bang:',
  WARN = ':warning:',
}

type MessageObject = {
  event: string;
  time: string;
  analysisUpdated?: number;
  error?: any;
};

const messageObjectTitles: Record<keyof MessageObject, string> = {
  event: 'Event',
  time: 'Time',
  analysisUpdated: 'Total analysis Updated',
  error: 'Error message',
};

export const sendSlackNotification = async ({
  message,
  category,
}: {
  message: MessageObject;
  category: NOTIFICATION_CATEGORY_ICON;
}): Promise<void> => {
  if (config.notifications?.slack_url) {
    logger.debug(`Attempting to send Slack notification...`);

    const header = `${category} Script status`;
    const body = Object.entries(message)
      .map(([key, val]) => `>*${messageObjectTitles[key as keyof MessageObject]}:* ${val}\n`)
      .join('');

    const payload = `${header}\n${body}`;

    await axios
      .post(config.notifications.slack_url, {
        text: payload,
      })
      .then(() => {
        logger.debug('Slack notification sent successfully.');
      })
      .catch((err) => {
        logger.warn(`Error sending slack notification: ${err}.`);
      });
  }
};
