import { withLambda } from "@netlify/aws-lambda-compat";
import serverlessHttp from "serverless-http";
import app from "../../artifacts/api-server/src/app";

// withLambda() runs this classic Lambda-signature handler (built by
// serverless-http exactly as before) on Netlify's MODERN Functions
// runtime instead of the deprecated "Lambda compatibility mode" the
// plain `export const handler = ...` form used. That old mode enforces
// AWS Lambda's hard 4KB total-environment-variable ceiling, which two
// service-account JSON credentials (Google Play + Firebase) together
// blew past. The modern runtime has no such limit — see
// https://www.netlify.com/changelog/2026-06-12-serverless-functions-env-var-size-limit-removed/
// — and this wrapper is Netlify's own documented migration path for an
// existing serverless-http/Express handler, so nothing about how
// requests are handled inside `app` needed to change.
export default withLambda(serverlessHttp(app));