import serverlessHttp from "serverless-http";
import app from "../../artifacts/api-server/src/app";

export const handler = serverlessHttp(app);
