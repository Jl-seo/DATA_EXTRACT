import 'server-only';
import z from 'zod';
import { headers } from 'next/headers';

import AuthService, { CurrentUser } from '@/services/AuthService';
import MSGraphService from '@/services/MSGraphService';
import CosmosDBService from '@/services/CosmosDBService';
import { PermissionGroup, PermissionGroupSchema, GroupMember, ModelPermission } from '@/scheme/permission';

import { parseMSGraphResponse } from '@/scheme/msgraph';
import {
  GlobalPermissionRoleType,
  GlobalPermissionListRequest,
  GlobalPermissionsCreateRequest,
  GlobalPermissionUpdateRoleRequest,
  GlobalPermissionDeleteRequest,
  GlobalPermissionBulkDeleteRequest,
  GLOBAL_PERMISSION_PARTITION_KEY,
  GlobalPermission
} from '@/scheme/permission';
import { getRedisClient } from '@/utils/redis';
import BaseService from './BaseService';
import { DAOMEnvConfig } from '@/scheme/env';

/**
 * admin: 관리자
 * user: 사용자
 * super_admin: 슈퍼관리자(Azure Role에서 User.SuperAdmin 지정)
 * none: 사용자 등록 x
 */
export type GlobalRole = GlobalPermissionRoleType | 'none';

export default class PermissionService extends BaseService {
  private redis = getRedisClient();
  private user?: CurrentUser;
  authService: AuthService;
  msGraphService: MSGraphService;
  cosmosDBService: CosmosDBService;

  constructor(envConfig: DAOMEnvConfig) {
    super(envConfig);
    this.authService = new AuthService(envConfig);
    this.msGraphService = new MSGraphService(envConfig);
    this.cosmosDBService = new CosmosDBService(envConfig);
  }

  private async k(s: string) {
    const prefix = `@daom_app/${this.envConfig.id}/${(await this.getCurrentUser())?.oid ?? ''}`;
    return `${prefix}/${s}`;
  }

  private async getCache<T>(baseKey: string): Promise<T | undefined> {
    const key = await this.k(baseKey);
    const val = await this.redis.get(key);
    return val ? JSON.parse(val) as T : undefined;
  }

  private async setCache<T>(baseKey: string, value: T, ttlSec: number) {
    const key = await this.k(baseKey);
    await this.redis.set(key, JSON.stringify(value), "EX", ttlSec);
  }

  private async delCache(baseKey: string) {
    const key = await this.k(baseKey);
    await this.redis.del(key);
  }

  public async clearUserModelRolesCache() {
    await this.delCache('user_model_roles');
  }

  /**
   * 현재 세션 사용자 return
   */
  async getCurrentUser() {
    if (this.user) return this.user;

    // 1. 세션 기반 인증 시도
    const sessionUser = await this.authService.getCurrentUser();
    if (sessionUser) {
      return this.user = sessionUser;
    }

    // 2. Bearer 토큰 기반 인증 시도 (외부 API 호출 대응)
    try {
      const headerList = await headers();
      const authHeader = headerList.get('authorization');
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        const extUser = headerList.get('X-MS-CLIENT-PRINCIPAL-NAME') || undefined;
        const verifiedUser = await this.authService.verifyAccessToken(token, extUser);
        if (verifiedUser) {
          console.log(`[PermissionService] Authenticated via Bearer Token: ${verifiedUser.upn}`);
          return this.user = verifiedUser;
        }
      }
    } catch (e) {
      // headers() 호출이 실패하는 환경(예: 정적 빌드 타임)일 수 있으므로 예외 처리
      console.warn('[PermissionService] Failed to get headers or verify token:', e);
    }

    return undefined;
  }

  /**
   * 슈퍼어드민 여부
   * @returns boolean
   */
  async isSuperAdmin() {
    if (process.env.DISABLED_SUPERADMIN) return false;
    const user = await this.getCurrentUser();
    const roles = (user?.roles ?? []) as any[];
    const isSuper = roles.includes('DAOM.SuperAdmin') || roles.includes('SuperAdmin');
    return isSuper;
  }

  /**
   * 사용자가 속해있는 group ids (5분)
   * @returns string[]
   */
  async getMemberOfGroupIds() {
    const baseKey = 'member_of_group_ids';
    const user = await this.getCurrentUser();
    if (!user) return [];
    const cached = await this.getCache<string[]>(baseKey);
    if (cached) return cached;

    const client = await this.msGraphService.getMSGraphClient();
    try {
      const response = await client
        .api(`/users/${user.oid}/getMemberGroups`)
        .post({ securityEnabledOnly: false });
      const ids = parseMSGraphResponse(response, z.array(z.string())).value;
      await this.setCache(baseKey, ids, 60 * 5);
      return ids;
    } catch (e: any) {
      if (e.statusCode === 404 || e.message?.includes('does not exist')) {
        console.warn(`[PermissionService] User ${user.oid} not found in Graph directory. Returning empty groups.`);
        return [];
      }
      throw e;
    }
  }

  /**
   * 사용자 사이트 권한 조회 (1분)
   * @returns
   */
  async getGlobalRole(): Promise<GlobalRole | undefined> {
    const user = await this.getCurrentUser();
    if (!user) return;
    if (await this.isSuperAdmin()) return 'admin';
    const baseKey = 'global_role';
    const cached = await this.getCache<GlobalRole>(baseKey);
    if (cached) return cached;

    const groupIds = await this.getMemberOfGroupIds();
    const container = await this.cosmosDBService.getContainer('permissions');
    const baseQuery = `
    SELECT TOP 1 1 
        FROM c
        WHERE (c.target.object_id = @userId
          OR ARRAY_CONTAINS(@groupIds, c.target.object_id))
    `;
    {
      const querySpec = {
        query: `${baseQuery} AND LOWER(c.role) = "admin"`,
        parameters: [
          { name: '@userId', value: user.oid },
          { name: '@groupIds', value: groupIds },
        ],
      };



      const { resources } = await container.items
        .query<{ _exists: 1 }>(querySpec, { partitionKey: 'global:global' })
        .fetchAll();

      if (resources.length > 0) {
        await this.setCache(baseKey, 'admin', 60);
        return 'admin';
      }
    }

    // Check if user is in a PermissionGroup that has superAdmin = true 슈퍼관리자 설정 확인
    {
      const querySpec = {
        query: `
          SELECT TOP 1 1 
          FROM c 
          WHERE c.partition_key = 'group' 
            AND c.permissions.superAdmin = true
            AND EXISTS(SELECT VALUE m FROM m IN c.members WHERE m.id = @userId OR m.id = @userUpn OR ARRAY_CONTAINS(@groupIds, m.id))
        `,
        parameters: [
          { name: '@userId', value: user.oid },
          { name: '@userUpn', value: user.upn },
          { name: '@groupIds', value: groupIds },
        ],
      };

      const { resources } = await container.items
        .query<{ _exists: 1 }>(querySpec, { partitionKey: 'group' })
        .fetchAll();

      if (resources.length > 0) {
        await this.setCache(baseKey, 'admin', 60);
        return 'admin';
      }
    }

    {
      const querySpec = {
        query: baseQuery,
        parameters: [
          { name: '@userId', value: user.oid },
          { name: '@groupIds', value: groupIds },
        ],
      };

      const { resources } = await container.items
        .query<{ _exists: 1 }>(querySpec, { partitionKey: 'global:global' })
        .fetchAll();

      if (resources.length > 0) {
        await this.setCache(baseKey, 'user', 60);
        return 'user';
      }
    }

    // [New] Check if user is in ANY PermissionGroup (as a standard member)
    {
      const querySpec = {
        query: `
          SELECT TOP 1 1 
          FROM c 
          WHERE c.partition_key = 'group' 
            AND EXISTS(SELECT VALUE m FROM m IN c.members WHERE m.id = @userId OR m.id = @userUpn OR ARRAY_CONTAINS(@groupIds, m.id))
        `,
        parameters: [
          { name: '@userId', value: user.oid },
          { name: '@userUpn', value: user.upn },
          { name: '@groupIds', value: groupIds },
        ],
      };

      const { resources } = await container.items
        .query<{ _exists: 1 }>(querySpec, { partitionKey: 'group' })
        .fetchAll();

      if (resources.length > 0) {
        await this.setCache(baseKey, 'user', 60);
        return 'user';
      }
    }

    const role: GlobalRole = 'none';
    await this.setCache(baseKey, role, 60);
    return role;
  }

  // ==========================================
  // Permission Groups CRUD
  // ==========================================

  async getPermissionGroups(): Promise<PermissionGroup[]> {
    const user = await this.getCurrentUser();
    if (!user) return [];

    const isSuperAdmin = await this.isSuperAdmin();
    const globalRole = await this.getGlobalRole();
    
    // If super admin or global admin, return all
    if (isSuperAdmin || globalRole === 'admin') {
      const container = await this.cosmosDBService.getContainer('permissions');
      const querySpec = {
        query: `SELECT * FROM c WHERE c.partition_key = 'group'`,
      };
      const { resources } = await container.items
        .query<PermissionGroup>(querySpec, { partitionKey: 'group' })
        .fetchAll();
      return resources;
    }

    // Otherwise, return only groups the user belongs to
    const container = await this.cosmosDBService.getContainer('permissions');
    const groupIds = await this.getMemberOfGroupIds();

    const querySpec = {
      query: `
        SELECT *
        FROM c 
        WHERE c.partition_key = 'group' 
          AND EXISTS(SELECT VALUE m FROM m IN c.members WHERE m.id = @userId OR m.id = @userUpn OR ARRAY_CONTAINS(@groupIds, m.id))
      `,
      parameters: [
        { name: '@userId', value: user.oid },
        { name: '@userUpn', value: user.upn },
        { name: '@groupIds', value: groupIds },
      ],
    };

    const { resources } = await container.items
      .query<PermissionGroup>(querySpec, { partitionKey: 'group' })
      .fetchAll();
    
    return resources;
  }

  async getPermissionGroupById(id: string): Promise<PermissionGroup | undefined> {
    const container = await this.cosmosDBService.getContainer('permissions');
    const { resource } = await container.item(id, 'group').read<PermissionGroup>();
    return resource;
  }

  async createPermissionGroup(name: string, description: string, superAdmin: boolean): Promise<PermissionGroup> {
    const user = await this.getCurrentUser();
    const group: PermissionGroup = PermissionGroupSchema.parse({
      name,
      description,
      permissions: { superAdmin, models: [], menus: [] },
      created_by: user?.oid,
    });

    // Security Check: Only Azure AD Super Admin can create Admin groups
    if (superAdmin && !(await this.isSuperAdmin())) {
      throw new Error('Only Azure AD Super Admins can create Admin groups.');
    }

    const container = await this.cosmosDBService.getContainer('permissions');
    const { resource } = await container.items.create(group);
    return resource!;
  }

  async updatePermissionGroup(id: string, name: string, description: string): Promise<PermissionGroup> {
    const container = await this.cosmosDBService.getContainer('permissions');
    const { resource: current } = await container.item(id, 'group').read<PermissionGroup>();
    if (!current) throw new Error('Group not found');

    const updated = {
      ...current,
      name,
      description,
      updated_at: new Date().toISOString()
    };

    const { resource } = await container.item(id, 'group').replace(updated);
    return resource!;
  }

  async deletePermissionGroup(id: string): Promise<void> {
    const container = await this.cosmosDBService.getContainer('permissions');
    await container.item(id, 'group').delete();
  }

  async addMemberToGroup(groupId: string, member: GroupMember): Promise<void> {
    const container = await this.cosmosDBService.getContainer('permissions');
    const { resource: group } = await container.item(groupId, 'group').read<PermissionGroup>();
    if (!group) throw new Error('Group not found');

    if (group.members.some(m => m.id === member.id)) return; // Already exists

    const updated = {
      ...group,
      members: [...group.members, member],
      updated_at: new Date().toISOString()
    };
    await container.item(groupId, 'group').replace(updated);
  }

  async removeMemberFromGroup(groupId: string, memberId: string): Promise<void> {
    const container = await this.cosmosDBService.getContainer('permissions');
    const { resource: group } = await container.item(groupId, 'group').read<PermissionGroup>();
    if (!group) throw new Error('Group not found');

    const updated = {
      ...group,
      members: group.members.filter(m => m.id !== memberId),
      updated_at: new Date().toISOString()
    };
    await container.item(groupId, 'group').replace(updated);
  }

  async updateGroupPermissions(groupId: string, superAdmin: boolean, models: ModelPermission[]): Promise<void> {
    const container = await this.cosmosDBService.getContainer('permissions');
    const { resource: group } = await container.item(groupId, 'group').read<PermissionGroup>();
    if (!group) throw new Error('Group not found');

    const updated = {
      ...group,
      permissions: {
        superAdmin,
        models
      },
      updated_at: new Date().toISOString()
    };
    await container.item(groupId, 'group').replace(updated);
  }

  /**
   * 사용자가 접근 가능한 모델 ID 목록 조회
   * @returns string[] (전체 접근 가능 시 ['*'] 반환)
   */
  async getAuthorizedModelIds(): Promise<string[]> {
    const user = await this.getCurrentUser();
    if (!user) return [];

    const role = await this.getGlobalRole();
    if (role === 'admin') return ['*'];

    const container = await this.cosmosDBService.getContainer('permissions');
    const groupIds = await this.getMemberOfGroupIds();

    const querySpec = {
      query: `
        SELECT VALUE c.permissions.models
        FROM c 
        WHERE c.partition_key = 'group' 
          AND EXISTS(SELECT VALUE m FROM m IN c.members WHERE m.id = @userId OR m.id = @userUpn OR ARRAY_CONTAINS(@groupIds, m.id))
      `,
      parameters: [
        { name: '@userId', value: user.oid },
        { name: '@userUpn', value: user.upn },
        { name: '@groupIds', value: groupIds },
      ],
    };

    const { resources } = await container.items
      .query<ModelPermission[]>(querySpec, { partitionKey: 'group' })
      .fetchAll();

    const modelIds = new Set<string>();
    for (const groupModels of resources) {
      if (!groupModels) continue;
      for (const m of groupModels) {
        modelIds.add(m.modelId);
      }
    }

    return Array.from(modelIds);
  }

  /**
   * 사용자가 접근 가능한 모델과 역할 목록 반환 (캐싱: 1분)
   */
  async getUserModelRoles(): Promise<ModelPermission[]> {
    const user = await this.getCurrentUser();
    if (!user) return [];

    const role = await this.getGlobalRole();
    if (role === 'admin') {
      return [{ modelId: '*', modelName: '모든 모델', role: 'Admin' }];
    }

    const baseKey = 'user_model_roles';
    const cached = await this.getCache<ModelPermission[]>(baseKey);
    if (cached) return cached;

    const container = await this.cosmosDBService.getContainer('permissions');
    const groupIds = await this.getMemberOfGroupIds();

    const querySpec = {
      query: `
        SELECT VALUE c.permissions.models
        FROM c 
        WHERE c.partition_key = 'group' 
          AND EXISTS(SELECT VALUE m FROM m IN c.members WHERE m.id = @userId OR m.id = @userUpn OR ARRAY_CONTAINS(@groupIds, m.id))
      `,
      parameters: [
        { name: '@userId', value: user.oid },
        { name: '@userUpn', value: user.upn },
        { name: '@groupIds', value: groupIds },
      ],
    };

    const { resources } = await container.items
      .query<ModelPermission[]>(querySpec, { partitionKey: 'group' })
      .fetchAll();

    const roleMap = new Map<string, ModelPermission>();
    for (const groupModels of resources) {
      if (!groupModels) continue;
      for (const m of groupModels) {
        // 동일 모델에 대해 Admin 권한이 User 권한보다 우선순위를 가짐
        const existing = roleMap.get(m.modelId);
        if (!existing || (existing.role === 'User' && m.role === 'Admin')) {
          roleMap.set(m.modelId, m);
        }
      }
    }

    const result = Array.from(roleMap.values());
    await this.setCache(baseKey, result, 60);
    return result;
  }

  // ==========================================
  // Graph API Helper
  // ==========================================

  async searchEntraUsers(query: string) {
    const client = await this.msGraphService.getMSGraphClient();
    const response = await client
      .api('/users')
      .header('ConsistencyLevel', 'eventual')
      .search(`"displayName:${query}" OR "mail:${query}"`)
      .select('id,displayName,mail,userPrincipalName')
      .top(10)
      .get();

    return response.value;
  }

  async getEntraUserByEmail(email: string) {
    const client = await this.msGraphService.getMSGraphClient();
    const response = await client
      .api('/users')
      .filter(`mail eq '${email}' or userPrincipalName eq '${email}'`)
      .select('id,displayName,mail,userPrincipalName')
      .get();

    return response.value?.[0];
  }

  async searchEntraGroups(query: string) {
    const client = await this.msGraphService.getMSGraphClient();
    const response = await client
      .api('/groups')
      .header('ConsistencyLevel', 'eventual')
      .search(`"displayName:${query}"`)
      .filter('securityEnabled eq true')
      .select('id,displayName,description')
      .top(10)
      .get();

    return response.value;
  }

  // ==========================================
  // Global Permissions CRUD
  // ==========================================

  async getGlobalPermissions(req: GlobalPermissionListRequest): Promise<{ items: GlobalPermission[]; total: number }> {
    const container = await this.cosmosDBService.getContainer('permissions');

    let query = `SELECT * FROM c WHERE c.partition_key = '${GLOBAL_PERMISSION_PARTITION_KEY}'`;
    const parameters: { name: string; value: any }[] = [];

    if (req.role && req.role !== 'all') {
      query += ` AND c.role = @role`;
      parameters.push({ name: '@role', value: req.role });
    }

    if (req.nameOrUpn) {
      // Simple search implementation
      query += ` AND (CONTAINS(c.target.displayName, @term, true) OR CONTAINS(c.target.email, @term, true))`;
      parameters.push({ name: '@term', value: req.nameOrUpn });
    }

    // Get Total Count
    const countQuerySpec = {
      query: query.replace('SELECT *', 'SELECT VALUE COUNT(1)'),
      parameters,
    };
    const { resources: countRes } = await container.items
      .query<number>(countQuerySpec, { partitionKey: GLOBAL_PERMISSION_PARTITION_KEY })
      .fetchAll();
    const total = countRes[0] || 0;

    // Apply Pagination
    if (req.offset !== null && req.offset !== undefined && req.limit) {
      query += ` OFFSET @offset LIMIT @limit`;
      parameters.push({ name: '@offset', value: req.offset });
      parameters.push({ name: '@limit', value: req.limit });
    }

    const querySpec = {
      query,
      parameters,
    };

    const { resources } = await container.items
      .query<GlobalPermission>(querySpec, { partitionKey: GLOBAL_PERMISSION_PARTITION_KEY })
      .fetchAll();

    return { items: resources, total };
  }

  async createGlobalPermissions(req: GlobalPermissionsCreateRequest): Promise<GlobalPermission[]> {
    const container = await this.cosmosDBService.getContainer('permissions');
    const user = await this.getCurrentUser();
    const createdItems: GlobalPermission[] = [];

    for (const item of req) {
      // Check duplicate
      const querySpec = {
        query: `SELECT * FROM c WHERE c.partition_key = @pk AND c.target.object_id = @targetId`,
        parameters: [
          { name: '@pk', value: GLOBAL_PERMISSION_PARTITION_KEY },
          { name: '@targetId', value: item.target.object_id }
        ]
      };
      const { resources } = await container.items.query(querySpec, { partitionKey: GLOBAL_PERMISSION_PARTITION_KEY }).fetchAll();

      if (resources.length > 0) {
        continue;
      }

      const newPerm: GlobalPermission = GlobalPermission.parse({
        partition_key: GLOBAL_PERMISSION_PARTITION_KEY,
        role: item.role,
        target_type: item.target_type,
        target: item.target,
        created_by: {
          object_id: user?.oid || 'system',
          name: user?.name || 'System',
          upn: user?.upn || '',
        },
      });

      const { resource } = await container.items.create(newPerm);
      if (resource) createdItems.push(resource);
    }
    return createdItems;
  }

  async updateGlobalPermissionRole(req: GlobalPermissionUpdateRoleRequest): Promise<{ statusCode: number; item: GlobalPermission }> {
    const container = await this.cosmosDBService.getContainer('permissions');
    const { resource: current } = await container.item(req.id, GLOBAL_PERMISSION_PARTITION_KEY).read<GlobalPermission>();

    if (!current) throw new Error('Permission not found');

    const user = await this.getCurrentUser();
    const updated = {
      ...current,
      role: req.role,
      modified_at: new Date().toISOString(),
      modified_by: {
        object_id: user?.oid || 'system',
        name: user?.name || 'System',
        upn: user?.upn || '',
      }
    };

    const { resource } = await container.item(req.id, GLOBAL_PERMISSION_PARTITION_KEY).replace(updated);
    return { statusCode: 200, item: resource! };
  }

  async deleteGlobalPermission(req: GlobalPermissionDeleteRequest): Promise<{ statusCode: number; item: { id: string } }> {
    const container = await this.cosmosDBService.getContainer('permissions');
    await container.item(req.id, GLOBAL_PERMISSION_PARTITION_KEY).delete();
    return { statusCode: 200, item: { id: req.id } };
  }

  async deleteGlobalPermissions(req: GlobalPermissionBulkDeleteRequest): Promise<{ successCount: number; items: GlobalPermission[]; errors: string[] }> {
    const container = await this.cosmosDBService.getContainer('permissions');
    const errors: string[] = [];
    let successCount = 0;

    for (const id of req.ids) {
      try {
        // Need to read first if we want to return items, but here we just need count maybe?
        // The hook expects items... let's just return minimal info or empty if acceptable.
        // Actually usually bulk delete returns list of deleted ids.
        // The hook says: items: GlobalPermission[]
        // Retrieving before delete is expensive.
        // Let's assume the hook uses items to filter local cache.
        // If I return empty items, cache invalidation might be needed.
        // But the hook does: queryClient.invalidateQueries
        // So returning empty items might be fine if only count matters for the toast.
        await container.item(id, GLOBAL_PERMISSION_PARTITION_KEY).delete();
        successCount++;
      } catch (e: any) {
        console.error(`Failed to delete permission ${id}`, e);
        errors.push(e.message);
      }
    }
    return { successCount, items: [], errors };
  }
}
