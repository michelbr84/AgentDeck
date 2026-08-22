import packageJson from '../package.json';

/**
 * Version and build metadata for Web Deck client.
 */
export const WEB_APP_VERSION = packageJson.version;
export const WEB_BUILD_ID = `build-v${packageJson.version}-web-client`;
export const WEB_BUILT_AT = '2026-08-21T00:00:00.000Z';
