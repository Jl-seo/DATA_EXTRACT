import {
  createSearchParamsCache,
  parseAsInteger,
  parseAsString,
  parseAsStringEnum,
} from 'nuqs/server';

export const globalPermissionSearchParamParsers = {
  offset: parseAsInteger.withDefault(0),
  pageSize: parseAsInteger.withDefault(10),
  nameOrUpn: parseAsString,
  role: parseAsStringEnum(['all', 'admin', 'user']).withDefault('all'),
  limit: parseAsInteger.withDefault(10),
};

export const globalPermissionSearchParamsCache =
  createSearchParamsCache(globalPermissionSearchParamParsers);
