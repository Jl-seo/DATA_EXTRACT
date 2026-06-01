import 'server-only';
import {
  BlobGenerateSasUrlOptions,
  BlobSASPermissions,
  BlobServiceClient,
  ContainerGenerateSasUrlOptions,
  ContainerSASPermissions,
  SASProtocol,
  StorageSharedKeyCredential,
} from '@azure/storage-blob';

import BaseService from './BaseService';
import { getCurrentEnvConfig } from '@/lib/env';

const CONTAINER = 'daom-data';

export default class BlobStorageService extends BaseService {
  static readonly COSMOS_SAFE_ITEM_BYTES = Math.floor(1.8 * 1024 * 1024);

  static isOffloadedReference(value: unknown): value is {
    _is_offloaded: true;
    blob_path: string;
    blob_url?: string;
    size?: number;
  } {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const candidate = value as Record<string, unknown>;
    return candidate._is_offloaded === true && typeof candidate.blob_path === 'string';
  }

  // 미리 정의된 SAS 옵션
  static readonly SAS = {
    // 읽기 전용 (60분)
    READ: (expiresInMinutes = 60): BlobGenerateSasUrlOptions => ({
      permissions: BlobSASPermissions.parse('r'),
      startsOn: new Date(Date.now() - 600 * 1000),
      expiresOn: new Date(Date.now() + expiresInMinutes * 60 * 1000),
      protocol: SASProtocol.Https,
    }),
    // 쓰기 전용 (10분)
    WRITE: (expiresInMinutes = 10): BlobGenerateSasUrlOptions => ({
      permissions: BlobSASPermissions.parse('cw'), // create + write
      startsOn: new Date(Date.now() - 600 * 1000),
      expiresOn: new Date(Date.now() + expiresInMinutes * 60 * 1000),
      protocol: SASProtocol.Https,
    }),
    // Container Write (10분)
    CONTAINER_WRITE: (expiresInMinutes = 10): ContainerGenerateSasUrlOptions => ({
      permissions: ContainerSASPermissions.parse('wl'), // write
      startsOn: new Date(Date.now() - 600 * 1000),
      expiresOn: new Date(Date.now() + expiresInMinutes * 60 * 1000),
      protocol: SASProtocol.Https,
    }),
  };

  async getCredential() {
    const sharedKeyCredential = new StorageSharedKeyCredential(
      this.envConfig.blob_storage.account_name,
      this.envConfig.blob_storage.account_key,
    );

    return sharedKeyCredential;
  }

  async getBlobServiceClient() {
    const config = await getCurrentEnvConfig();

    const credential = await this.getCredential();

    const blobServiceClient = new BlobServiceClient(
      `https://${config.blob_storage.account_name}.blob.core.windows.net`,
      credential,
    );

    return blobServiceClient;
  }

  async getContainerClient(container?: string) {
    const config = await getCurrentEnvConfig();
    const containerName = container || config.blob_storage.container || CONTAINER;
    const blobServiceClient = await this.getBlobServiceClient();
    const containerClient = blobServiceClient.getContainerClient(containerName);
    await containerClient.createIfNotExists();
    return containerClient;
  }

  async getBlobClient(blobName: string) {
    const blobClient = await this.getContainerClient();
    return blobClient.getBlobClient(blobName);
  }

  // temp blob storage
  async getTempCredential() {
    const sharedKeyCredential = new StorageSharedKeyCredential(
      this.envConfig.temp_blob_storage.account_name,
      this.envConfig.temp_blob_storage.account_key,
    );

    return sharedKeyCredential;
  }

  async getTempBlobServiceClient() {
    const config = await getCurrentEnvConfig();

    const credential = await this.getTempCredential();

    const blobServiceClient = new BlobServiceClient(
      `https://${config.temp_blob_storage.account_name}.blob.core.windows.net`,
      credential,
    );

    return blobServiceClient;
  }

  async getTempContainerClient(container?: string) {
    const config = await getCurrentEnvConfig();
    const containerName = container || config.temp_blob_storage?.container || CONTAINER;
    const blobServiceClient = await this.getTempBlobServiceClient();
    const containerClient = blobServiceClient.getContainerClient(containerName);
    await containerClient.createIfNotExists();
    return containerClient;
  }

  async getTempBlobClient(blobName: string) {
    const blobClient = await this.getTempContainerClient();
    return blobClient.getBlobClient(blobName);
  }

  async generateSasUrl(
    blobPath: string,
    options: BlobGenerateSasUrlOptions,
    disableCustomHost?: boolean,
  ): Promise<string> {
    // If blobPath contains custom host, extract only the actual blob path
    let actualBlobPath = blobPath;
    if (this.envConfig.blob_storage.custom_public_host && blobPath.startsWith(this.envConfig.blob_storage.custom_public_host)) {
      // Remove custom host from the path
      actualBlobPath = blobPath.substring(this.envConfig.blob_storage.custom_public_host.length + 1);
    }

    const blobClient = await this.getBlobClient(actualBlobPath);
    let sasUrl = await blobClient.generateSasUrl(options);

    if (!disableCustomHost && this.envConfig.blob_storage.custom_public_host) {
      sasUrl = this.applyCustomPublicHost(sasUrl, this.envConfig.blob_storage.custom_public_host);
    }

    return sasUrl;
  }

  private applyCustomPublicHost(sasUrl: string, customPublicHost: string): string {
    const raw = customPublicHost.trim();
    if (!raw) return sasUrl;

    try {
      const originalUrl = new URL(sasUrl);
      const customUrl = new URL(raw.includes('://') ? raw : `https://${raw}`);

      originalUrl.protocol = customUrl.protocol || originalUrl.protocol;
      originalUrl.host = customUrl.host;

      const prefixPath = customUrl.pathname.replace(/\/+$/, '');
      if (prefixPath && prefixPath !== '/') {
        const merged = `${prefixPath}/${originalUrl.pathname.replace(/^\/+/, '')}`;
        originalUrl.pathname = merged.replace(/\/{2,}/g, '/');
      }

      return originalUrl.toString();
    } catch {
      // 레거시 호환: host 문자열만 전달된 경우
      const originalUrl = new URL(sasUrl);
      originalUrl.host = raw;
      return originalUrl.toString();
    }
  }

  async generateContainerSasUrl(
    blobPath: string,
    options: ContainerGenerateSasUrlOptions,
  ): Promise<string> {
    const containerClient = await this.getContainerClient();
    const sasUrl = await containerClient.generateSasUrl(options);

    const [baseUrl, query] = sasUrl.split('?');

    const encodedPath = blobPath
      .split('/')
      .map((part) => encodeURIComponent(part))
      .join('/');

    return `${baseUrl}/${encodedPath}?${query}`;
  }

  // temp blob storage와 일반 blob storage가 동일한지 확인
  private isTempStorageSameAsMain(): boolean {
    const main = this.envConfig.blob_storage;
    const temp = this.envConfig.temp_blob_storage;

    if (!temp) return true;

    const mainContainer = main.container || CONTAINER;
    const tempContainer = temp.container || CONTAINER;

    return (
      main.account_name === temp.account_name &&
      main.account_key === temp.account_key &&
      mainContainer === tempContainer
    );
  }

  async generateTempSasUrl(
    blobPath: string,
    options: BlobGenerateSasUrlOptions,
  ): Promise<{ sasUrl: string; tempBlobPath?: string; cleanup: () => Promise<void> }> {
    // temp storage와 main storage가 동일하면 기존 함수 재사용 (cleanup 불필요)
    if (this.isTempStorageSameAsMain()) {
      const sasUrl = await this.generateSasUrl(blobPath, options);
      return {
        sasUrl,
        cleanup: async () => { },
      };
    }
    // main storage에 blob이 있는지 확인
    const mainBlobClient = await this.getBlobClient(blobPath);
    const exists = await mainBlobClient.exists();
    if (!exists) {
      throw new Error(`Blob ${blobPath} not found`);
    }

    // temp 파일명 생성
    const tempBlobPath = `temp/${blobPath.split('/').slice(1).join('/')}`;
    const blobClient = await this.getTempBlobClient(tempBlobPath);

    // 원본 파일을 temp storage로 복사
    const originSasUrl = await this.generateSasUrl(blobPath, BlobStorageService.SAS.READ(), true);
    const poller = await blobClient.beginCopyFromURL(originSasUrl, {
      intervalInMs: 1000,
    });
    await poller.pollUntilDone();

    // temp 파일의 SAS URL 생성
    let sasUrl = await blobClient.generateSasUrl(options);

    if (this.envConfig.temp_blob_storage.custom_public_host) {
      sasUrl = this.applyCustomPublicHost(sasUrl, this.envConfig.temp_blob_storage.custom_public_host);
    }

    // cleanup 함수: temp 파일 삭제
    // NOTE: server에서 사용 안하면 추후 삭제
    const cleanup = async () => {
      await this.deleteTempBlob(tempBlobPath);
    };

    return { sasUrl, tempBlobPath, cleanup };
  }

  async moveTempToOrigin(tempBlobPath: string, originBlobPath: string) {
    const blobClient = await this.getBlobClient(originBlobPath);

    // Temp 파일을 Origin storage로 복사
    // Start reading from the temp blob
    const tempBlobClient = await this.getTempBlobClient(tempBlobPath);
    const tempSasUrl = await tempBlobClient.generateSasUrl(BlobStorageService.SAS.READ());

    const poller = await blobClient.beginCopyFromURL(tempSasUrl, {
      intervalInMs: 1000,
    });
    await poller.pollUntilDone();

    // Delete temp blob
    await this.deleteTempBlob(tempBlobPath);
  }

  async generateTempContainerSasUrl(
    blobPath: string,
    options: ContainerGenerateSasUrlOptions,
    disableCustomHost?: boolean,
  ): Promise<{ sasUrl: string; tempBlobPath?: string; cleanup?: () => Promise<void> }> {
    if (this.isTempStorageSameAsMain()) {
      const sasUrl = await this.generateContainerSasUrl(blobPath, options);
      return { sasUrl, cleanup: undefined };
    }

    const containerClient = await this.getTempContainerClient();

    // Note: We are ignoring the random tempFileName logic in favor of using the requested blobPath
    // on the temp container. This mirrors the folder structure on the temp storage.
    // If we wanted to force a random filename, we would return that new path in the SAS URL instead.

    let sasUrl = await containerClient.generateSasUrl(options);

    // Use temp_blob_storage custom host if available
    if (!disableCustomHost && this.envConfig.temp_blob_storage.custom_public_host) {
      sasUrl = this.applyCustomPublicHost(sasUrl, this.envConfig.temp_blob_storage.custom_public_host);
    }

    const tempBlobPath = `temp/${blobPath.split('/').slice(1).join('/')}`;

    const [baseUrl, query] = sasUrl.split('?');
    const encodedPath = tempBlobPath
      .split('/')
      .map((part) => encodeURIComponent(part))
      .join('/');

    // NOTE: server에서 사용 안하면 추후 삭제
    const copyToOrigin = async () => {
      const blobClient = await this.getBlobClient(blobPath);

      // Temp 파일을 Origin storage로 복사
      const tempSasUrl = await this.generateSasUrl(`${baseUrl}/${encodedPath}`, BlobStorageService.SAS.READ(), true);
      const poller = await blobClient.beginCopyFromURL(tempSasUrl, {
        intervalInMs: 1000,
      });
      await poller.pollUntilDone();
    }

    // 원본에 카피 먼저 하고 temp 삭제
    // NOTE: server에서 사용 안하면 추후 삭제
    const cleanup = async () => {
      await copyToOrigin();
      await this.deleteTempBlob(tempBlobPath);
    };

    return { sasUrl: `${baseUrl}/${encodedPath}?${query}`, tempBlobPath, cleanup: cleanup };
  }

  async deleteTempBlob(blobPath: string) {
    const blobClient = await this.getTempBlobClient(blobPath);
    await blobClient.deleteIfExists({ deleteSnapshots: 'include' });
  }

  async deleteBlob(blobPath: string) {
    const blobClient = await this.getBlobClient(blobPath);
    await blobClient.deleteIfExists({ deleteSnapshots: 'include' });
  }

  async uploadAsset(file: File): Promise<{ url: string; filename: string }> {

    // Get hostname/env-id to namespace the assets
    const hostname = this.envConfig.id;

    // Generate unique filename
    const ext = file.name.split('.').pop();
    const uniqueId = crypto.randomUUID();
    const filename = `${uniqueId}.${ext}`;

    // Blob path: {hostname}/settings/{filename}
    const blobPath = `${hostname}/settings/${filename}`;

    const containerClient = await this.getContainerClient();
    const blockBlobClient = containerClient.getBlockBlobClient(blobPath);

    const arrayBuffer = await file.arrayBuffer();
    await blockBlobClient.upload(arrayBuffer, arrayBuffer.byteLength, {
      blobHTTPHeaders: { blobContentType: file.type }
    });

    // Return the public URL
    const publicUrl = `/api/settings/${filename}`;

    return {
      url: publicUrl,
      filename: filename
    };
  }

  async uploadDocument(file: File, folder: string = 'documents'): Promise<{ url: string; filename: string; blobPath: string }> {
    const hostname = this.envConfig.id;
    const ext = file.name.split('.').pop();
    const uniqueId = crypto.randomUUID();
    const filename = `${uniqueId}.${ext}`;

    // Path: {hostname}/{folder}/{filename}
    const blobPath = `${hostname}/${folder}/${filename}`;

    const containerClient = await this.getContainerClient();
    const blockBlobClient = containerClient.getBlockBlobClient(blobPath);

    const arrayBuffer = await file.arrayBuffer();
    await blockBlobClient.upload(arrayBuffer, arrayBuffer.byteLength, {
      blobHTTPHeaders: { blobContentType: file.type }
    });

    // We return the SAS URL or just the path? 
    // For extraction, we often need SAS URL or just path to generate SAS later.
    // The previous uploadAsset returned a public URL /api/..., assuming a proxy exists.
    // Here we return blobPath so Action can generate SAS if needed, or just store the path.

    return {
      url: blockBlobClient.url,
      filename: file.name, // Original filename
      blobPath: blobPath
    };
  }

  async uploadBuffer(buffer: Buffer, blobPath: string, contentType: string = 'application/octet-stream'): Promise<string> {
    const containerClient = await this.getContainerClient();
    const blockBlobClient = containerClient.getBlockBlobClient(blobPath);
    await blockBlobClient.upload(buffer, buffer.length, {
      blobHTTPHeaders: { blobContentType: contentType }
    });
    return blockBlobClient.url;
  }

  async uploadJson(blobPath: string, jsonContent: string, contentType: string = 'application/json'): Promise<string> {
    const containerClient = await this.getContainerClient();
    const blockBlobClient = containerClient.getBlockBlobClient(blobPath);
    await blockBlobClient.upload(jsonContent, jsonContent.length, {
      blobHTTPHeaders: { blobContentType: contentType }
    });
    return blockBlobClient.url;
  }

  async downloadJson<T>(blobPath: string): Promise<T> {
    const blobClient = await this.getBlobClient(blobPath);
    const downloadResponse = await blobClient.download();
    const body = await this.streamToBuffer(downloadResponse.readableStreamBody!);
    return JSON.parse(body.toString()) as T;
  }

  private async streamToBuffer(readableStream: NodeJS.ReadableStream): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      readableStream.on('data', (data) => {
        chunks.push(data instanceof Buffer ? data : Buffer.from(data));
      });
      readableStream.on('end', () => {
        resolve(Buffer.concat(chunks));
      });
      readableStream.on('error', reject);
    });
  }

  /**
   * 블롭을 Buffer로 다운로드합니다.
   */
  async downloadBuffer(blobPath: string): Promise<Buffer> {
    const blobClient = await this.getBlobClient(blobPath);
    const downloadResponse = await blobClient.download();
    return await this.streamToBuffer(downloadResponse.readableStreamBody!);
  }

  /**
   * 임시 저장소의 블롭을 Buffer로 다운로드합니다.
   */
  async downloadTempBuffer(tempBlobPath: string): Promise<Buffer> {
    const blobClient = await this.getTempBlobClient(tempBlobPath);
    const downloadResponse = await blobClient.download();
    return await this.streamToBuffer(downloadResponse.readableStreamBody!);
  }

  /**
   * 데이터 크기를 체크하고 필요 시 Blob Storage로 오프로딩합니다.
   */
  async maybeOffloadData(logId: string, data: any, threshold: number = 1.5 * 1024 * 1024): Promise<{ data: any; offloaded: boolean }> {
    if (!data) return { data, offloaded: false };

    const jsonString = JSON.stringify(data);
    if (jsonString.length <= threshold) {
      return { data, offloaded: false };
    }

    console.log(`[BlobStorageService] Large data detected for ${logId} (${jsonString.length} bytes). Offloading...`);
    
    // 파일명 형식: extraction-results/{logId}.json
    const blobPath = `extraction-results/${logId}.json`;
    const blobUrl = await this.uploadJson(blobPath, jsonString);

    return {
      data: {
        _is_offloaded: true,
        blob_url: blobUrl,
        blob_path: blobPath, // 내부 참조용 경로 (SAS 생성 등에 필요할 수 있음)
        size: jsonString.length
      },
      offloaded: true
    };
  }

  private estimateJsonSizeBytes(data: unknown): number {
    return Buffer.byteLength(JSON.stringify(data), 'utf8');
  }

  async fitDocumentToItemLimit(params: {
    logId: string;
    document: Record<string, unknown>;
    thresholdBytes?: number;
    fieldPriority?: string[];
  }): Promise<{
    document: Record<string, unknown>;
    itemSizeBytes: number;
    offloadedFields: string[];
  }> {
    const thresholdBytes = params.thresholdBytes ?? BlobStorageService.COSMOS_SAFE_ITEM_BYTES;
    const fieldPriority = params.fieldPriority ?? ['debug_data', 'preview_data', 'extracted_data'];
    const fittedDocument: Record<string, unknown> = { ...params.document };
    const offloadedFields: string[] = [];
    let itemSizeBytes = this.estimateJsonSizeBytes(fittedDocument);

    if (itemSizeBytes <= thresholdBytes) {
      return { document: fittedDocument, itemSizeBytes, offloadedFields };
    }

    for (const field of fieldPriority) {
      if (itemSizeBytes <= thresholdBytes) break;
      const fieldValue = fittedDocument[field];
      if (fieldValue === undefined || fieldValue === null) continue;
      if (BlobStorageService.isOffloadedReference(fieldValue)) continue;

      const fieldJson = JSON.stringify(fieldValue);
      const blobPath = `extraction-results/${params.logId}/${field}.json`;
      const blobUrl = await this.uploadJson(blobPath, fieldJson);
      fittedDocument[field] = {
        _is_offloaded: true,
        blob_url: blobUrl,
        blob_path: blobPath,
        size: Buffer.byteLength(fieldJson, 'utf8')
      };
      offloadedFields.push(field);
      itemSizeBytes = this.estimateJsonSizeBytes(fittedDocument);
    }

    return { document: fittedDocument, itemSizeBytes, offloadedFields };
  }
}
