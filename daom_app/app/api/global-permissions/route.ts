import { getGlobalPermissions } from '@/actions/permission';
import {
  GlobalPermissionListRequest,
  GlobalPermission,
} from '@/scheme/permission';

import { makeApi } from '@/lib/api';

const handlers = {
  GET: makeApi({
    method: 'GET',
    schema: GlobalPermissionListRequest,
    async handler({ input }): Promise<GlobalPermission[] | number> {
      const { items, total } = await getGlobalPermissions(input);
      if (input.count) return total;
      return items;
    },
  }),
};

export const { GET } = handlers;
