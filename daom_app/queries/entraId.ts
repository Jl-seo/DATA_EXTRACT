import {
  listUsers,
  listGroups,
} from '@/actions/entraId';
import {
  UserListRequestInput,
  UserListRequest,
  GroupListRequestInput,
  GroupListRequest,
} from '@/scheme/entraId';
import {
  infiniteQueryOptions,
} from '@tanstack/react-query';

export function buildAdminEntraIDUserListInfiniteQuery(
  req: UserListRequestInput,
) {
  return infiniteQueryOptions({
    queryKey: ['_next', 'admin', 'entraID', 'users', req],
    queryFn: ({ pageParam }) =>
      listUsers(
        UserListRequest.parse({
          ...req,
          skipToken: pageParam,
        } satisfies UserListRequestInput),
      ),
    initialPageParam: '',
    getNextPageParam: (lastPage) => lastPage.$skipToken,
    getPreviousPageParam: (lastPage, pages) => pages.at(-1)?.$skipToken,
  });
}

export function buildAdminEntraIDGroupListInfiniteQuery(
  req: GroupListRequestInput,
) {
  return infiniteQueryOptions({
    queryKey: ['_next', 'admin', 'entraID', 'groups', req],
    queryFn: ({ pageParam }) =>
      listGroups(
        GroupListRequest.parse({
          ...req,
          skipToken: pageParam,
        } satisfies GroupListRequestInput),
      ),
    initialPageParam: '',
    getNextPageParam: (lastPage) => lastPage.$skipToken,
    getPreviousPageParam: (lastPage, pages) => pages.at(-1)?.$skipToken,
  });
}
