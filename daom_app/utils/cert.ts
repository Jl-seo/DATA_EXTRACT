import forge from 'node-forge';

export function parsePfx(base64EncodedPfx: string, password: string = '') {
  const pfxBase64 = base64EncodedPfx;
  const pfxBytes = Buffer.from(pfxBase64, 'base64');

  // Convert from ArrayBuffer to binary string
  const p12Der = forge.util.binary.raw.encode(new Uint8Array(pfxBytes));

  // Get asn.1 structure from DER
  const p12Asn1 = forge.asn1.fromDer(p12Der);

  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password);

  // Extract the key
  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });

  const bag = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0];

  if (!bag?.key) {
    throw new Error('No key bags found');
  }

  const privateKeyPem = forge.pki.privateKeyToPem(bag.key);
  // Extract the certificate
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
  const certBag = certBags[forge.pki.oids.certBag]?.[0];

  if (!certBag?.cert) {
    throw new Error('No certificate bags found');
  }

  const certificatePem = forge.pki.certificateToPem(certBag.cert);
  // Calculate the SHA-1 thumbprint of the certificate
  const md = forge.md.sha1.create();
  md.update(
    forge.asn1.toDer(forge.pki.certificateToAsn1(certBag.cert)).getBytes(),
  );
  const thumbprint = md.digest().toHex().toUpperCase();

  return {
    privateKey: privateKeyPem,
    certificatePem: certificatePem,
    thumbprint: thumbprint,
  } as const;
}
