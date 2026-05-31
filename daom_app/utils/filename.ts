export function normalizeFilename(filename: string) {
  return filename.normalize('NFC').toLowerCase();
}

export function checkIfFileNeedConvert(fileName: string) {
  return (
    !fileName.toLowerCase().endsWith('.pdf')
  );
}