'use server';

import 'server-only';
import BlobStorageService from '@/services/BlobStorageService';
import CosmosDBService from '@/services/CosmosDBService';
import PermissionService from '@/services/PermissionService';
import { getCurrentEnvConfig } from '@/lib/env';
import { File as FileRecord, SOURCE_TYPE } from '@/scheme/file';
import { normalizeFilename } from '@/utils/filename';
import { PDFDocument, type PDFPage } from 'pdf-lib';

interface ContentStreamLike {
  getContents: () => Uint8Array;
}

interface ContentStreamArrayLike {
  size: () => number;
  lookup: (index: number) => unknown;
}

interface SanitizedPdfResult {
  sanitizedBuffer: Buffer;
  removedPageNumbers: number[];
}

function isContentStreamLike(value: unknown): value is ContentStreamLike {
  if (value === null || typeof value !== 'object') return false;
  return typeof (value as { getContents?: unknown }).getContents === 'function';
}

function isContentStreamArrayLike(value: unknown): value is ContentStreamArrayLike {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as { size?: unknown; lookup?: unknown };
  return typeof candidate.size === 'function' && typeof candidate.lookup === 'function';
}

function hasMeaningfulBytes(bytes: Uint8Array): boolean {
  for (let idx = 0; idx < bytes.length; idx++) {
    const charCode = bytes[idx];
    const isWhitespace =
      charCode === 0x20 || // space
      charCode === 0x09 || // tab
      charCode === 0x0A || // line feed
      charCode === 0x0D || // carriage return
      charCode === 0x0C;   // form feed
    if (!isWhitespace) return true;
  }
  return false;
}

function pageHasMeaningfulContent(page: PDFPage): boolean {
  const annots = page.node.Annots();
  if (annots && annots.size() > 0) return true;

  const contents = page.node.Contents();
  if (!contents) return false;

  if (isContentStreamLike(contents)) {
    return hasMeaningfulBytes(contents.getContents());
  }

  if (isContentStreamArrayLike(contents)) {
    for (let idx = 0; idx < contents.size(); idx++) {
      const contentEntry = contents.lookup(idx);
      if (!contentEntry) continue;
      if (isContentStreamLike(contentEntry)) {
        if (hasMeaningfulBytes(contentEntry.getContents())) return true;
        continue;
      }
      // 알 수 없는 객체 타입은 보수적으로 "내용 있음"으로 처리
      return true;
    }
    return false;
  }

  // 예상하지 못한 타입은 보수적으로 "내용 있음"으로 처리
  return true;
}

async function sanitizePdfByRemovingEmptyPages(pdfBuffer: Buffer): Promise<SanitizedPdfResult | null> {
  const sourceDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  const totalPages = sourceDoc.getPageCount();
  if (totalPages <= 1) return null;

  const keepPageIndices: number[] = [];
  const removedPageNumbers: number[] = [];

  for (let pageIndex = 0; pageIndex < totalPages; pageIndex++) {
    const page = sourceDoc.getPage(pageIndex);
    if (pageHasMeaningfulContent(page)) {
      keepPageIndices.push(pageIndex);
    } else {
      removedPageNumbers.push(pageIndex + 1);
    }
  }

  if (removedPageNumbers.length === 0) return null;
  if (keepPageIndices.length === 0) {
    console.warn('[PDF SANITIZE] 모든 페이지가 빈 페이지로 판정되어 원본을 유지합니다.');
    return null;
  }

  const sanitizedDoc = await PDFDocument.create();
  const copiedPages = await sanitizedDoc.copyPages(sourceDoc, keepPageIndices);
  copiedPages.forEach((page) => sanitizedDoc.addPage(page));

  const sanitizedBytes = await sanitizedDoc.save();
  return {
    sanitizedBuffer: Buffer.from(sanitizedBytes),
    removedPageNumbers,
  };
}


// Re-export existing uploadFile for backward compatibility if needed, 
// or keep it if it's used. ensuring it uses FileRecord correctly.
export async function uploadFile(formData: FormData) {
  const file = formData.get('file') as unknown as File;
  if (!file) {
    throw new Error('No file provided');
  }

  const envConfig = await getCurrentEnvConfig();
  const permissionService = new PermissionService(envConfig);
  const user = await permissionService.getCurrentUser();
  if (!user) throw new Error('Unauthorized');

  const cosmosDBService = new CosmosDBService(envConfig);
  const blobStorageService = new BlobStorageService(envConfig);

  // 1. Upload to Blob Storage
  const uploadResult = await blobStorageService.uploadDocument(file, 'documents');

  // 2. Create File Record in Cosmos DB
  const filesContainer = await cosmosDBService.getContainer('files');

  const fileId = crypto.randomUUID();
  const now = new Date().toISOString();

  const fileRecord: FileRecord = {
    id: fileId,
    partition_key: SOURCE_TYPE,
    data_type: SOURCE_TYPE,
    filename: file.name,
    normalized_filename: normalizeFilename(file.name),
    filename_without_ext: file.name.replace(/\.[^.]+$/, ''),
    file_type: file.name.split('.').pop()?.toUpperCase() || '',
    blob_path: uploadResult.blobPath,
    created_at: now,
    created_by: {
      name: user.name,
      object_id: user.oid,
      upn: user.upn
    },
    modified_at: now,
    modified_by: {
      name: user.name,
      object_id: user.oid,
      upn: user.upn
    }
  };

  await filesContainer.items.create(fileRecord);

  return {
    fileId: fileId,
    filename: file.name,
    url: uploadResult.url
  };
}






export async function createFileData(fileData: Partial<FileRecord>) {
  const envConfig = await getCurrentEnvConfig();
  const permissionService = new PermissionService(envConfig);
  const user = await permissionService.getCurrentUser();
  if (!user) throw new Error('Unauthorized');

  const cosmosDBService = new CosmosDBService(envConfig);
  const filesContainer = await cosmosDBService.getContainer('files');

  const now = new Date().toISOString();

  // Fill required fields
  const fileRecord: FileRecord = {
    id: fileData.id || crypto.randomUUID(),
    partition_key: fileData.partition_key || SOURCE_TYPE,
    data_type: fileData.data_type || SOURCE_TYPE,
    filename: fileData.filename || 'unknown',
    normalized_filename: normalizeFilename(fileData.filename || 'unknown'),
    filename_without_ext: (fileData.filename || 'unknown').replace(/\.[^.]+$/, ''),
    file_type: (fileData.filename || 'unknown').split('.').pop()?.toUpperCase() || '',
    blob_path: fileData.blob_path || '',
    created_at: now,
    created_by: {
      name: user.name,
      object_id: user.oid,
      upn: user.upn
    },
    modified_at: now,
    modified_by: {
      name: user.name,
      object_id: user.oid,
      upn: user.upn
    },
    ...fileData // Override with provided data
  };

  await filesContainer.items.create(fileRecord);
  return fileRecord;
}

export async function deleteFile({ id, partition_key }: { id: string; partition_key: string }) {
  const envConfig = await getCurrentEnvConfig();
  const permissionService = new PermissionService(envConfig);
  const user = await permissionService.getCurrentUser();
  if (!user) throw new Error('Unauthorized');

  const cosmosDBService = new CosmosDBService(envConfig);
  const blobStorageService = new BlobStorageService(envConfig);
  const filesContainer = await cosmosDBService.getContainer('files');

  try {
    const { resource: file } = await filesContainer.item(id, partition_key).read<FileRecord>();
    if (file) {
      // Delete Blob
      if (file.blob_path) {
        await blobStorageService.deleteBlob(file.blob_path);
      }
      // Delete DB Record
      await filesContainer.item(id, partition_key).delete();
    }
  } catch (e) {
    console.error('Delete file error:', e);
    // Ignore if not found
  }
}

export async function convertDocument(blobPath: string) {
  // Placeholder for document conversion (e.g. to PDF)
  console.warn(`[convertDocument] Conversion requested for ${blobPath}. Implementation missing.`);
  return;
}

/**
 * Generate SAS URL for browser-side file upload
 */
export async function generateUploadSasUrl(filename: string, folder: string = 'documents') {
  const envConfig = await getCurrentEnvConfig();
  const permissionService = new PermissionService(envConfig);
  const user = await permissionService.getCurrentUser();
  if (!user) throw new Error('Unauthorized');

  const cosmosDBService = new CosmosDBService(envConfig);
  const blobStorageService = new BlobStorageService(envConfig);

  // Generate unique file ID and blob path
  const fileId = crypto.randomUUID();
  const ext = filename.split('.').pop() || '';
  const uniqueFilename = `${fileId}.${ext}`;

  // blob_path: relative path only (e.g., "documents/xxx.pdf")
  const blobPath = `${folder}/${uniqueFilename}`;

  // Actual blob storage path includes environment ID (e.g., "localhost/documents/xxx.pdf")
  const actualBlobPath = `${envConfig.id}/${folder}/${uniqueFilename}`;

  // Generate SAS URL with WRITE permission (10 minutes)
  // custom_public_host가 설정된 경우 업로드도 해당 도메인으로 유도
  const sasUrl = await blobStorageService.generateSasUrl(
    actualBlobPath,
    BlobStorageService.SAS.WRITE(10)
  );




  // Create file record in Cosmos DB with 'uploading' status
  const filesContainer = await cosmosDBService.getContainer('files');
  const now = new Date().toISOString();

  const fileRecord: FileRecord = {
    id: fileId,
    partition_key: SOURCE_TYPE,
    data_type: SOURCE_TYPE,
    filename: filename,
    normalized_filename: normalizeFilename(filename),
    filename_without_ext: filename.replace(/\.[^.]+$/, ''),
    file_type: ext.toUpperCase(),
    blob_path: blobPath,
    created_at: now,
    created_by: {
      name: user.name,
      object_id: user.oid,
      upn: user.upn
    },
    modified_at: now,
    modified_by: {
      name: user.name,
      object_id: user.oid,
      upn: user.upn
    }
  };

  await filesContainer.items.create(fileRecord);

  return {
    sasUrl,
    blobPath,
    fileId,
    filename
  };
}

/**
 * Confirm file upload completion and get file URL
 */
export async function confirmFileUpload(fileId: string) {
  const envConfig = await getCurrentEnvConfig();
  const permissionService = new PermissionService(envConfig);
  const user = await permissionService.getCurrentUser();
  if (!user) throw new Error('Unauthorized');

  const cosmosDBService = new CosmosDBService(envConfig);
  const blobStorageService = new BlobStorageService(envConfig);
  const filesContainer = await cosmosDBService.getContainer('files');

  // Get file record
  const { resource: fileRecord } = await filesContainer.item(fileId, SOURCE_TYPE).read<FileRecord>();
  if (!fileRecord) {
    throw new Error('File record not found');
  }

  // Verify blob exists
  // Actual blob storage path includes environment ID (e.g., "localhost/documents/xxx.pdf")
  const actualBlobPath = `${envConfig.id}/${fileRecord.blob_path}`;

  const blobClient = await blobStorageService.getBlobClient(actualBlobPath);
  const exists = await blobClient.exists();
  if (!exists) {
    throw new Error('File upload verification failed: blob not found');
  }

  let removedBlankPages: number[] = [];
  const isPdf = fileRecord.filename.toLowerCase().endsWith('.pdf');
  if (isPdf) {
    try {
      const originalPdfBuffer = await blobStorageService.downloadBuffer(actualBlobPath);
      const sanitizedPdf = await sanitizePdfByRemovingEmptyPages(originalPdfBuffer);

      if (sanitizedPdf) {
        removedBlankPages = sanitizedPdf.removedPageNumbers;
        await blobStorageService.uploadBuffer(
          sanitizedPdf.sanitizedBuffer,
          actualBlobPath,
          'application/pdf'
        );
        console.info(
          `[PDF SANITIZE] 빈 페이지 제거 완료 fileId=${fileId} removed=${sanitizedPdf.removedPageNumbers.join(',')}`
        );
      }
    } catch (sanitizeError) {
      console.warn('[PDF SANITIZE] 빈 페이지 제거 실패 - 원본을 유지합니다.', sanitizeError);
    }
  }

  // Generate read SAS URL (60 minutes) using original blob storage URL
  const url = await blobStorageService.generateSasUrl(
    actualBlobPath,
    BlobStorageService.SAS.READ(60),
    true  // disableCustomHost - use original blob.core.windows.net URL
  );

  return {
    fileId,
    filename: fileRecord.filename,
    url,
    blobPath: fileRecord.blob_path,
    removed_blank_pages: removedBlankPages
  };
}

/**
 * Get a temporary READ SAS URL for a given blob path
 */
export async function getFileSasUrl(blobPath: string) {
  const envConfig = await getCurrentEnvConfig();
  const permissionService = new PermissionService(envConfig);
  const user = await permissionService.getCurrentUser();
  if (!user) throw new Error('Unauthorized');

  const blobStorageService = new BlobStorageService(envConfig);

  // Ensure the blobPath has the environment ID prefix if it doesn't already
  const actualBlobPath = blobPath.startsWith(`${envConfig.id}/`)
    ? blobPath
    : `${envConfig.id}/${blobPath}`;

  const url = await blobStorageService.generateSasUrl(
    actualBlobPath,
    BlobStorageService.SAS.READ(60),
    true // disableCustomHost
  );



  return url;
}
