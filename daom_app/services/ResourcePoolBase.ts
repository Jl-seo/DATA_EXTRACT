import { DAOMEnvConfig } from "@/scheme/env";
import BaseService from "./BaseService";

export interface ResourcePick<T> {
  resource?: T;
  index?: number;
}

export class ResourcePoolBase<T> extends BaseService {
  protected readonly shuffleOnGet: boolean;
  protected resources: T[] = [];

  constructor(envConfig: DAOMEnvConfig, resources: T[] = [], options?: { shuffle?: boolean }) {
    super(envConfig);
    this.resources = resources;
    this.shuffleOnGet = options?.shuffle ?? false;
  }

  protected shuffleArray(input: readonly T[]): T[] {
    const result = [...input];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  getResourceCount(): number {
    return this.resources.length;
  }

  getResources(count?: number): T[] {
    const base = this.shuffleOnGet
      ? this.shuffleArray(this.resources)
      : [...this.resources];

    if (typeof count !== 'number') return base;
    return base.slice(0, Math.max(0, count));
  }

  getBestResource(idx?: number): ResourcePick<T> {
    if (!this.resources || this.resources.length === 0)
      return { resource: undefined, index: undefined };
    // TODO: 사용량에 따라서 로테이션

    // array에서 랜덤으로 선택 idx가 있으면 idx 우선
    if (!idx || this.resources.length <= idx)
      idx = Math.floor(Math.random() * this.resources.length);
    return {
      resource: this.resources[idx],
      index: idx,
    };
  }

  getResourceById(id: string): T | undefined {
    return this.resources.find((r: any) => r.resource_name === id);
  }
}
