const { NodeSDK } = require('@opentelemetry/sdk-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-proto');
const { resourceFromAttributes } = require('@opentelemetry/resources');
const { LangfuseSpanProcessor } = require('@langfuse/otel');
const {
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} = require('@opentelemetry/sdk-trace-base');
const config = require('../config');

let sdk = null;
let started = false;

function isEnabled() {
  return Boolean(config.observability.enabled && started);
}

function getMissingConfig() {
  const required = {
    CLS_DEFAULT_REGION: config.observability.region,
    CLS_TOPIC_ID: config.observability.topicId,
    TENCENTCLOUD_SECRET_ID: config.observability.secretId,
    TENCENTCLOUD_SECRET_KEY: config.observability.secretKey,
  };
  return Object.entries(required)
    .filter(([, value]) => !value)
    .map(([key]) => key);
}

async function start() {
  if (!config.observability.enabled) return;

  const missing = getMissingConfig();
  if (missing.length) {
    console.warn(`[obs] disabled, missing env: ${missing.join(', ')}`);
    return;
  }

  const {
    region, topicId, secretId, secretKey, serviceName, sampleRatio,
  } = config.observability;
  const auth = Buffer.from(`${secretId}:${secretKey}`).toString('base64');

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      'service.name': serviceName,
      'deployment.environment': process.env.NODE_ENV || 'development',
      'cloud.provider': 'tencent_cloud',
      'cloud.region': region,
    }),
    sampler: new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(sampleRatio),
    }),
    spanProcessors: [
      new LangfuseSpanProcessor({
        exporter: new OTLPTraceExporter({
          url: `https://${region}.cls.tencentcs.com/v1/traces`,
          headers: {
            Authorization: `Basic ${auth}`,
            topic_id: topicId,
          },
        }),
        flushAt: 1,
        flushInterval: 1000,
      }),
    ],
  });

  await sdk.start();
  started = true;
  console.log(`[obs] CLS Agent observability enabled: ${serviceName}@${region}`);
}

async function shutdown() {
  if (!sdk || !started) return;
  try {
    await sdk.shutdown();
    console.log('[obs] flushed traces');
  } catch (err) {
    console.warn('[obs] shutdown failed:', err.message, err.code || '', err.data || '');
  } finally {
    started = false;
    sdk = null;
  }
}

module.exports = {
  start,
  shutdown,
  isEnabled,
};
