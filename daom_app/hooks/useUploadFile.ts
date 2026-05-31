import { useState } from 'react';
import { uploadFile } from '@/actions/file';

export function useUploadFile() {
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);

    const upload = async (file: File) => {
        setIsLoading(true);
        setError(null);
        try {
            const formData = new FormData();
            formData.append('file', file);

            const result = await uploadFile(formData);

            // Result contains fileId (blobPath), filename, url
            return result;
        } catch (err: any) {
            console.error("Upload failed", err);
            setError(err);
            throw err;
        } finally {
            setIsLoading(false);
        }
    };

    return { upload, isLoading, error };
}
