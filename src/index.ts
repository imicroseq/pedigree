import * as dotenv from 'dotenv';
dotenv.config({
	debug: process.env.ENABLE_DEBUG === 'true',
});
import minimist from 'minimist';
import _ from 'lodash';

import logger from '@/utils/logger';
import { adoptCacheIfNeeded, startLoadCachePipeline } from '@/cache';
import { disconnectRedis } from '@/cache/redisConfig';
import { startUpdateAnalysisPipeline } from '@/services/index';
import { sendSlackNotification, NOTIFICATION_CATEGORY_ICON } from '@/utils/slackNotifications';
import { todaysDateTimezoned, msToTimeFormat } from '@/utils/dates';
import { analysis_patch_failed, analysis_patch_success } from '@/services/song';

enum Profiles {
	UPDATECACHE = 'UPDATECACHE',
	UPDATEANALYSIS = 'UPDATEANALYSIS',
}

/**
 * Main Function - All work done here
 */
async function runScript(args: any) {
	let argv = minimist(args);
	let profile = _.toUpper(argv.profile);

	logger.info(`Starting script with profile=${profile}`);
	const startTime = process.hrtime.bigint();
	await sendSlackNotification({
		message: { event: "Starting script from a developer's laptop", time: todaysDateTimezoned() },
		category: NOTIFICATION_CATEGORY_ICON.INFO,
	});
	try {
		switch (profile) {
			case Profiles.UPDATECACHE:
				// this profile will save in cache all current analysis
				await startLoadCachePipeline();
				break;
			case Profiles.UPDATEANALYSIS:
				await adoptCacheIfNeeded();
				await startUpdateAnalysisPipeline();
				break;

			default:
				// this profile will start updating cache to then proceed to update analysis data
				await startLoadCachePipeline().then(startUpdateAnalysisPipeline);
				break;
		}
		logger.info(`Script completed successfully`);
		await sendSlackNotification({
			message: {
				event: 'Script completed',
				time: todaysDateTimezoned(),
				analysisUpdated: analysis_patch_success,
			},
			category: NOTIFICATION_CATEGORY_ICON.INFO,
		});
	} catch (error) {
		logger.error(error instanceof Error ? error.message : String(error));
		await sendSlackNotification({
			message: {
				event: 'Script finished with error',
				time: todaysDateTimezoned(),
				error: error,
				analysisUpdated: analysis_patch_success,
			},
			category: NOTIFICATION_CATEGORY_ICON.ERROR,
		});
	} finally {
		logger.info(
			`SUMMARY:
      total analysis updated: ${analysis_patch_success}
      total analysis failed: ${analysis_patch_failed}
      Time elapsed: ${msToTimeFormat(process.hrtime.bigint() - startTime)} `,
		);
		await disconnectRedis();
		process.exit();
	}
}

/**
 * RUN SCRIPT
 */
runScript(process.argv.slice(2));
