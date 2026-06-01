'use server';

import { z } from 'zod';

import { parseMSGraphResponse } from '@/scheme/msgraph';
import AuthService from '@/services/AuthService';
import MSGraphService from '@/services/MSGraphService';

import {
  UserListRequestInput,
  UserListRequest,
  EntraIDUser,
  GroupListRequestInput,
  GroupListRequest,
  EntraIDGroup,
  GroupMembersListRequest
} from '@/scheme/entraId';
import { SessionAuthError } from '@/lib/errors';
import { getCurrentEnvConfig } from '@/lib/env';


export async function listUsers(reqInput: UserListRequestInput) {
  const envConfig = await getCurrentEnvConfig();

  const msGraphService = new MSGraphService(envConfig);

  const req = UserListRequest.parse(reqInput);
  const graph = await msGraphService.getMSGraphClient();

  const params = new URLSearchParams({
    $select: 'id,displayName,userPrincipalName',
    $top: req.pageSize.toString(),
  });

  if (req.skipToken) {
    params.append('$skipToken', req.skipToken);
  }

  if (req.search) {
    params.append(
      '$search',
      `"displayName:${req.search}" OR "mail:${req.search}" OR "userPrincipalName:${req.search}" OR "givenName:${req.search}" OR "surName:${req.search}" OR "otherMails:${req.search}"`,
    );
  }

  const response = await graph
    .api(`/users?${params.toString()}`)
    .header('ConsistencyLevel', 'eventual')
    .get();

  return parseMSGraphResponse(response, z.array(EntraIDUser));
}

export async function listGroups(reqInput: GroupListRequestInput) {
  const envConfig = await getCurrentEnvConfig();

  const msGraphService = new MSGraphService(envConfig);

  const req = GroupListRequest.parse(reqInput);

  const graph = await msGraphService.getMSGraphClient();

  const params = new URLSearchParams({
    $select: 'id,displayName,mailEnabled,securityEnabled,groupTypes,mail',
    $top: req.pageSize.toString(),
  });

  if (req.skipToken) {
    params.append('$skipToken', req.skipToken);
  }

  if (req.search) {
    params.append(
      '$search',
      `"displayName:${req.search}" OR "mail:${req.search}"`,
    );
  }

  let groupTypeParams = undefined;
  const filters = [];

  if (reqInput.groupType !== 'all') {
    if (reqInput.groupType === 'M365') {
      groupTypeParams = `groupTypes/any(c:c eq 'Unified')`;
    } else if (reqInput.groupType === 'Security') {
      groupTypeParams = `mailEnabled eq false and securityEnabled eq true`;
    }
    filters.push(groupTypeParams);
  }

  if (filters.length > 0) {
    params.append('$filter', filters.join(' and '));
  }

  const response = await graph
    .api(`/groups?${params.toString()}`)
    .header('ConsistencyLevel', 'eventual')
    .get();

  return parseMSGraphResponse(response, z.array(EntraIDGroup));
}

export async function listGroupMembers(req: GroupMembersListRequest) {
  const envConfig = await getCurrentEnvConfig();

  const msGraphService = new MSGraphService(envConfig);

  req = GroupMembersListRequest.parse(req);

  if (req === undefined) {
    return null;
  }

  const graph = await msGraphService.getMSGraphClient();

  const response = await graph.api(`/groups/${req.id}/members`).get();

  return parseMSGraphResponse(response, z.array(EntraIDUser));
}

export async function listGroupsOfUsers() {
  const envConfig = await getCurrentEnvConfig();

  const authService = new AuthService(envConfig);
  const session = await authService.getSession();

  if (!session?.user?.upn || !session?.user?.name) {
    throw new SessionAuthError('Session not found');
  }

  const msGraphService = new MSGraphService(envConfig);

  const graph = await msGraphService.getMSGraphClient();

  const response = await graph
    .api(`/users/${session.user.oid}/transitiveMemberOf/microsoft.graph.group`)
    .get();

  return parseMSGraphResponse(response, z.array(EntraIDGroup));
}
