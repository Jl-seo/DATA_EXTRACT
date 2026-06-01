import { DAOMEnvConfig } from "@/scheme/env";

export default class BaseService {
  envConfig: DAOMEnvConfig;

  constructor(envConfig: DAOMEnvConfig) {
    this.envConfig = envConfig;
  }
}
