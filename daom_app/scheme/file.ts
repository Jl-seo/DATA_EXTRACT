import { z } from 'zod';
import dayjs from '@/lib/dayjs';
import { UserObject } from './common';
import { normalizeFilename } from '@/utils/filename';
import mime from 'mime-types';

export const FILE_ACCEPT = ['docx', 'doc', 'pptx', 'ppt', 'pdf']
  .map(mime.lookup)
  .join(',');

export const GENERAL_FILE_ACCEPT = ['png', 'jpg', 'jpeg', 'ico']
  .map(mime.lookup)
  .join(',');

export const MAX_FILE_UPLOAD_VOLUME = 200 * 1000 * 1000;
export const MAX_FILES_COUNT = 5;


export const SOURCE_TYPE = 'translation_source' as const;
export const TARGET_TYPE = 'translation_target' as const;
export const FILE_UPLOAD_TYPE = z.enum([SOURCE_TYPE, TARGET_TYPE]);

export type SOURCE_TYPE = z.infer<typeof SOURCE_TYPE>;
export type TARGET_TYPE = z.infer<typeof TARGET_TYPE>;
export type FILE_UPLOAD_TYPE = z.infer<typeof FILE_UPLOAD_TYPE>;

/**
 * <file 스키마>
 * id: uuid
 * partition_key: source or target
 * filename: 파일명
 * normalized_filename: normalized_filename
 * filename_without_ext: 확장자 제외 파일명
 * file_type: 파일 타입
 * blob_path: blob path(추후 공유 기능 생길 것 대비 - "oid/filename")
 * created_at: 만든 날짜(ISO8601)
 * created_by: 만든 사람
 * modified_at: 수정된 날짜(ISO8601)
 * modified_by: 수정한 사람
 */

export const File = z.object({
  id: z.string().default(() => crypto.randomUUID()),
  partition_key: z.string(),
  data_type: FILE_UPLOAD_TYPE,
  filename: z.string(),
  normalized_filename: z.string(),
  normalized_filename_without_ext: z.string().optional(), // Added purely to match potential inferred usage if any, but sticking to previous definition mostly
  filename_without_ext: z.string(),
  file_type: z.string(),
  blob_path: z.string(),
  created_at: z.string().default(() => dayjs().utc().toISOString()),
  created_by: UserObject,
  modified_at: z.string(),
  modified_by: UserObject,
})

export type File = z.infer<typeof File>;

export const FileInput = File.extend({
  partition_key: File.shape.partition_key.optional(),
  normalized_filename: File.shape.normalized_filename.optional(),
  filename_without_ext: File.shape.filename_without_ext.optional(),
  file_type: File.shape.file_type.optional(),
  modified_by: File.shape.modified_by.optional(),
  modified_at: File.shape.modified_at.optional(),
}).refine((data) => {
  if (!data.modified_by) {
    data.modified_by = data.created_by;
  }

  if (!data.modified_at) {
    data.modified_at = data.created_at;
  }

  if (!data.normalized_filename) {
    data.normalized_filename = normalizeFilename(data.filename);
  }

  if (!data.filename_without_ext) {
    data.filename_without_ext = data.filename.replace(/\.[^.]+$/, '');
  }

  if (!data.file_type) {
    data.file_type = data.filename.split('.').pop()?.toUpperCase() || '';
  }

  if (!data.partition_key) {
    if (data.data_type === SOURCE_TYPE) {
      data.partition_key = SOURCE_TYPE;
    } else {
      data.partition_key = TARGET_TYPE;
    }
  }

  return true;
});

export type FileInput = z.input<typeof FileInput>;

export const FileListRequest = File.pick({
  data_type: true,
});

export type FileListRequest = z.input<typeof FileListRequest>;

export const FileDeleteRequest = File.pick({
  id: true,
  partition_key: true,
});

export type FileDeleteRequest = z.infer<typeof FileDeleteRequest>;

export const FileDataCreateRequest = File.pick({
  data_type: true,
  filename: true,
  id: true,
});

export type FileDataCreateRequest = z.infer<typeof FileDataCreateRequest>;

export const SettingFilesDeleteRequest = z.object({
  filenames: z.array(File.shape.filename),
});

export type SettingFilesDeleteRequest = z.infer<typeof SettingFilesDeleteRequest>;

export const FileUploadRequest = z.object({
  filenames: z.array(z.string()),
  type: z.enum([SOURCE_TYPE, TARGET_TYPE]),
});

export type FileUploadRequest = z.infer<typeof FileUploadRequest>;

export interface FileUploadStatusBase {
  type: string;
  filename: string;
}

export interface FileUploading extends FileUploadStatusBase {
  type: 'uploading';
  title: string;
  index: number;
}

export interface FileUploaded extends FileUploadStatusBase {
  type: 'uploaded';
  title: string;
  index: number;
}

export interface FileConverting extends FileUploadStatusBase {
  type: 'converting';
  title: string;
  index: number;
}

export interface FileConverted extends FileUploadStatusBase {
  type: 'converted';
  title: string;
  index: number;
}

export interface FileRemovingMip extends FileUploadStatusBase {
  type: 'removing_mip';
  title: string;
  index: number;
}

export interface FileRemovedMip extends FileUploadStatusBase {
  type: 'removed_mip';
  title: string;
  index: number;
}

export interface FileUploadSuccess {
  type: 'success';
  files: File[];
  index: number;
}

export interface FileUploadError {
  type: 'error';
  errorMessage: string;
  index: number;
}

export interface FileUploadExist extends FileUploadStatusBase {
  type: 'exist_file';
  title: string;
  index: number;
}

export interface FileConvertingError extends FileUploadStatusBase {
  type: 'converting_error';
  title: string;
  index: number;
}

export interface FileRemovingMipError extends FileUploadStatusBase {
  type: 'removing_mip_error';
  title: string;
  index: number;
}

export type FileUploadStatus =
  | FileUploaded
  | FileUploading
  | FileConverting
  | FileConverted
  | FileRemovingMip
  | FileRemovedMip
  | FileUploadError
  | FileUploadSuccess
  | FileUploadExist
  | FileConvertingError
  | FileRemovingMipError;

export const REMOVE_MIP_CODE = {
  SUCCESS: 0,
  ERROR_UNKNOWN: 1,
  ERROR_PERMISSION: 2,
  NO_PROTECTION: -1,
} as const;

type REMOVE_MIP_CODE = (typeof REMOVE_MIP_CODE)[keyof typeof REMOVE_MIP_CODE];

interface RemoveMipResponseBase {
  result_code: REMOVE_MIP_CODE;
  out_path: string | null;
}

export interface RemoveMipSuccess extends RemoveMipResponseBase {
  result_code: 0;
  out_path: string;
}

export interface RemoveMipError extends RemoveMipResponseBase {
  result_code: 1 | 2;
  out_path: null;
}

export interface RemoveMipNoProtection extends RemoveMipResponseBase {
  result_code: -1;
  out_path: null;
}

export type RemoveMipResponse =
  | RemoveMipSuccess
  | RemoveMipError
  | RemoveMipNoProtection;

export class FileUploadException extends Error { }

export class FileConvertException extends Error { }

export class FileMIPRemoveException extends Error { }