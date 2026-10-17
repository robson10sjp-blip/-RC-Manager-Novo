import {
  randomBytes,
  scrypt,
  scryptSync,
  createCipheriv,
  createDecipheriv,
  createHash,
} from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { chmod, link, lstat, open, realpath, rm, stat, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { once } from "node:events";
import { Readable, Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

const FORMAT = "rc-firestore-backup-encrypted";
const VERSION = 1;
const MAGIC = Buffer.from("RCFIRE01");
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const SCRYPT_OPTIONS = { N: 1 << 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };
const deriveKeyAsync = promisify(scrypt);

function validatePassphrase(passphrase) {
  if (typeof passphrase !== "string" || Buffer.byteLength(passphrase, "utf8") < 16) {
    throw new Error("A senha de criptografia deve ter pelo menos 16 bytes.");
  }
}

async function resolveOutputPath(outputPath, repoRoot) {
  if (typeof outputPath !== "string" || !isAbsolute(outputPath)) {
    throw new Error("O caminho de saída deve ser absoluto.");
  }

  if (!outputPath.endsWith(".json.enc")) {
    throw new Error("O arquivo de saída deve terminar em .json.enc.");
  }

  const resolvedPath = resolve(outputPath);
  const resolvedRepo = await realpath(repoRoot);

  const candidateRelativePath = relative(resolvedRepo, resolvedPath);
  if (
    candidateRelativePath === "" ||
    (!candidateRelativePath.startsWith(`..${sep}`) &&
      candidateRelativePath !== ".." &&
      !isAbsolute(candidateRelativePath))
  ) {
    throw new Error("O backup deve ser gravado fora do repositório.");
  }

  const resolvedDirectory = await realpath(dirname(resolvedPath));
  const finalPath = resolve(resolvedDirectory, basename(resolvedPath));
  const fromRepo = relative(resolvedRepo, finalPath);

  if (
    fromRepo === "" ||
    (!fromRepo.startsWith(`..${sep}`) && fromRepo !== ".." && !isAbsolute(fromRepo))
  ) {
    throw new Error("O backup deve ser gravado fora do repositório.");
  }

  try {
    await lstat(finalPath);
    throw new Error("O arquivo de saída já existe; não será sobrescrito.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  return finalPath;
}

function makeHeader(salt, nonce) {
  return Buffer.from(
    JSON.stringify({
      format: FORMAT,
      version: VERSION,
      algorithm: "aes-256-gcm",
      kdf: "scrypt",
      scrypt: SCRYPT_OPTIONS,
      salt: salt.toString("base64"),
      nonce: nonce.toString("base64"),
    }),
    "utf8"
  );
}

function makePrefix(header) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(header.length);
  return Buffer.concat([MAGIC, length, header]);
}

async function hashFile(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function readExactly(fileHandle, length, position) {
  const buffer = Buffer.alloc(length);
  let bytesRead = 0;

  while (bytesRead < length) {
    const result = await fileHandle.read(
      buffer,
      bytesRead,
      length - bytesRead,
      position + bytesRead
    );
    if (result.bytesRead === 0) throw new Error("Arquivo criptografado truncado.");
    bytesRead += result.bytesRead;
  }

  return buffer;
}

export async function verifyEncryptedFile(filePath, passphrase) {
  validatePassphrase(passphrase);
  const fileHandle = await open(filePath, "r");

  try {
    const fileStat = await fileHandle.stat();
    if (fileStat.size < MAGIC.length + 4 + TAG_LENGTH) {
      throw new Error("Arquivo criptografado inválido ou incompleto.");
    }

    const magic = await readExactly(fileHandle, MAGIC.length, 0);
    if (!magic.equals(MAGIC)) throw new Error("Formato de backup desconhecido.");

    const lengthBuffer = await readExactly(fileHandle, 4, MAGIC.length);
    const headerLength = lengthBuffer.readUInt32BE(0);
    const headerStart = MAGIC.length + 4;
    const payloadStart = headerStart + headerLength;
    if (
      headerLength < 2 ||
      headerLength > 4096 ||
      payloadStart + TAG_LENGTH >= fileStat.size
    ) {
      throw new Error("Cabeçalho ou conteúdo criptografado incompleto.");
    }

    const headerBuffer = await readExactly(fileHandle, headerLength, headerStart);
    const header = JSON.parse(headerBuffer.toString("utf8"));
    if (
      header.format !== FORMAT ||
      header.version !== VERSION ||
      header.algorithm !== "aes-256-gcm" ||
      header.kdf !== "scrypt" ||
      JSON.stringify(header.scrypt) !== JSON.stringify(SCRYPT_OPTIONS)
    ) {
      throw new Error("Parâmetros criptográficos não suportados.");
    }

    const salt = Buffer.from(header.salt, "base64");
    const nonce = Buffer.from(header.nonce, "base64");
    if (salt.length !== 16 || nonce.length !== 12) {
      throw new Error("Parâmetros criptográficos inválidos.");
    }

    const tag = await readExactly(fileHandle, TAG_LENGTH, fileStat.size - TAG_LENGTH);
    const key = await deriveKeyAsync(passphrase, salt, KEY_LENGTH, SCRYPT_OPTIONS);
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(headerBuffer);
    decipher.setAuthTag(tag);
    let plaintextBytes = 0;

    try {
      await pipeline(
        createReadStream(filePath, {
          start: payloadStart,
          end: fileStat.size - TAG_LENGTH - 1,
        }),
        decipher,
        new Writable({
          write(chunk, encoding, callback) {
            plaintextBytes += chunk.length;
            callback();
          },
        })
      );
    } finally {
      key.fill(0);
    }

    if (plaintextBytes === 0) throw new Error("Conteúdo JSON vazio.");
    return { plaintextBytes };
  } finally {
    await fileHandle.close();
  }
}

export async function encryptJsonToFile(
  jsonChunks,
  { outputPath, repoRoot, passphrase }
) {
  validatePassphrase(passphrase);
  const finalPath = await resolveOutputPath(outputPath, repoRoot);
  const temporaryPath = `${finalPath}.partial-${process.pid}-${randomBytes(6).toString("hex")}`;
  const salt = randomBytes(16);
  const nonce = randomBytes(12);
  const header = makeHeader(salt, nonce);
  const prefix = makePrefix(header);
  const key = await deriveKeyAsync(passphrase, salt, KEY_LENGTH, SCRYPT_OPTIONS);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(header);

  let output;
  try {
    output = createWriteStream(temporaryPath, { flags: "wx", mode: 0o600 });
    await once(output, "open");
    await new Promise((resolveWrite, rejectWrite) => {
      output.write(prefix, (error) => (error ? rejectWrite(error) : resolveWrite()));
    });

    const appendTag = new Transform({
      transform(chunk, encoding, callback) {
        callback(null, chunk);
      },
      flush(callback) {
        callback(null, cipher.getAuthTag());
      },
    });

    await pipeline(Readable.from(jsonChunks), cipher, appendTag, output);
    await chmod(temporaryPath, 0o600);

    const fileHandle = await open(temporaryPath, "r+");
    await fileHandle.sync();
    await fileHandle.close();

    const temporaryStat = await stat(temporaryPath);
    if (temporaryStat.size <= prefix.length + TAG_LENGTH) {
      throw new Error("A exportação criptografada ficou vazia.");
    }

    const verification = await verifyEncryptedFile(temporaryPath, passphrase);
    const sha256 = await hashFile(temporaryPath);
    await link(temporaryPath, finalPath);
    await unlink(temporaryPath);

    return {
      outputPath: finalPath,
      size: temporaryStat.size,
      sha256,
      verified: true,
      plaintextBytes: verification.plaintextBytes,
    };
  } catch (error) {
    output?.destroy();
    await rm(temporaryPath, { force: true });
    throw error;
  } finally {
    key.fill(0);
  }
}

export function decryptBackupBuffer(encrypted, passphrase) {
  validatePassphrase(passphrase);

  if (!Buffer.isBuffer(encrypted) || encrypted.length < MAGIC.length + 4 + TAG_LENGTH) {
    throw new Error("Arquivo criptografado inválido ou incompleto.");
  }

  if (!encrypted.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error("Formato de backup desconhecido.");
  }

  const headerLength = encrypted.readUInt32BE(MAGIC.length);
  const headerStart = MAGIC.length + 4;
  const payloadStart = headerStart + headerLength;

  if (headerLength < 2 || payloadStart + TAG_LENGTH >= encrypted.length) {
    throw new Error("Cabeçalho ou conteúdo criptografado incompleto.");
  }

  const headerBuffer = encrypted.subarray(headerStart, payloadStart);
  const header = JSON.parse(headerBuffer.toString("utf8"));
  if (
    header.format !== FORMAT ||
    header.version !== VERSION ||
    header.algorithm !== "aes-256-gcm" ||
    header.kdf !== "scrypt"
  ) {
    throw new Error("Parâmetros criptográficos não suportados.");
  }

  const salt = Buffer.from(header.salt, "base64");
  const nonce = Buffer.from(header.nonce, "base64");
  if (salt.length !== 16 || nonce.length !== 12) {
    throw new Error("Parâmetros criptográficos inválidos.");
  }

  const key = scryptSync(passphrase, salt, KEY_LENGTH, SCRYPT_OPTIONS);
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAAD(headerBuffer);
  decipher.setAuthTag(encrypted.subarray(-TAG_LENGTH));

  try {
    return Buffer.concat([
      decipher.update(encrypted.subarray(payloadStart, -TAG_LENGTH)),
      decipher.final(),
    ]);
  } finally {
    key.fill(0);
  }
}