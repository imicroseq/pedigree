import { createClient, createCluster, RedisClientType, RedisClusterType } from 'redis';

import { config } from '@/config';
import logger from '@/utils/logger';

type RedisClient = RedisClientType | RedisClusterType;
type RedisHost = { host: string; port: number };

type RedisHostConfig = {
	password: string;
	socket: {
		host: string;
		port: number;
	};
};

const parseHosts = (hostValue: string, fallbackPort: number): RedisHost[] => {
	const entries = hostValue
		.split(',')
		.map((entry) => entry.trim())
		.filter(Boolean);

	// If they give no host, it must be local
	if (entries.length === 0) {
		return [{ host: 'localhost', port: fallbackPort }];
	}

	return entries.map((entry) => {
		// does the entry have both host:port
		const match = entry.match(/^(.*):(\d+)$/);

		return match ? { host: match[1], port: Number(match[2]) } : { host: entry, port: fallbackPort };
	});
};

const hosts = parseHosts(config.redis.host, config.redis.port);
const multipleHosts = hosts.length > 1;
const makeHostConfig = ({ host, port }: RedisHost): RedisHostConfig => ({
	password: config.redis.password,
	socket: {
		host,
		port,
	},
});
const hostConfigs = (multipleHosts ? hosts : [hosts[0]]).map(makeHostConfig);
const isCluster = multipleHosts || hosts[0].host.includes('cluster');
const client: RedisClient = isCluster ? createCluster({ rootNodes: hostConfigs }) : createClient(hostConfigs[0]);

client.on('error', (err) => {
	const detail =
		err instanceof AggregateError
			? err.errors.map((e: unknown) => (e instanceof Error ? e.message : String(e))).join('; ')
			: err instanceof Error
				? err.message
				: String(err);
	throw new Error(`Redis Client Error: ${detail}`);
});

const isSingleClientOpen = (redisClient: RedisClient): boolean => {
	if ('isOpen' in redisClient && typeof (redisClient as RedisClientType).isOpen === 'boolean') {
		return (redisClient as RedisClientType).isOpen;
	}

	return false;
};

const ping = async () => {
	const pingResult = await client.ping();
	if (pingResult !== 'PONG') {
    	throw new Error('Redis client connected but did not respond to PING');
    }
	logger.info('Redis client is connected and ready');
}

export const connectRedis = async (): Promise<void> => {
	if (!isCluster && isSingleClientOpen(client)) {
		return;
	}

	await client.connect();

	await ping();
};

export const disconnectRedis = async (): Promise<void> => {
	await client.close();
};

export type keyFormat = string;

export const saveHash = async (key: keyFormat, value: Record<string, string | number>) => {
	return await client.hSet(key, [...Object.entries(value).flat()]);
};

export const existsKey = async (key: keyFormat): Promise<boolean> => {
	return (await client.exists(key)) > 0;
};

export const getHash = async (key: keyFormat) => {
	return await client.hGetAll(key);
};

export const getKeyCount = async (): Promise<number> => {
	return await client.dbSize();
};
