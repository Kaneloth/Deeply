import pino from "pino";

// Netlify Functions run on AWS Lambda under the hood. pino-pretty spawns a
// separate worker thread that loads a module file on disk — this doesn't
// work inside Netlify's single-file bundled functions, so we must skip it
// there regardless of NODE_ENV.
const isServerless =
  process.env.NETLIFY === "true" ||
  process.env.AWS_LAMBDA_FUNCTION_NAME !== undefined;

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
  ...(isProduction || isServerless
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});