import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  decryptBackupBuffer,
  encryptJsonToFile,
  verifyEncryptedFile,
} from "../src/crypto.mjs";

const passphrase = "fixture-only-backup-passphrase";

test("encrypts JSON outside the repository and allows authenticated recovery", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rc-backup-fixture-"));
  const outputPath = join(directory, "fixture.json.enc");
  const plaintext = '{"fixture":"somente fictício","documents":[{"id":"x"}]}';

  try {
    const result = await encryptJsonToFile([plaintext], {
      outputPath,
      repoRoot: resolve("."),
      passphrase,
    });
    const encrypted = await readFile(outputPath);
    const fileStat = await stat(outputPath);

    assert.equal(result.outputPath, outputPath);
    assert.equal(result.verified, true);
    assert.equal(fileStat.mode & 0o777, 0o600);
    assert.equal(encrypted.includes(Buffer.from("somente fictício")), false);
    assert.deepEqual(JSON.parse(decryptBackupBuffer(encrypted, passphrase).toString()), {
      fixture: "somente fictício",
      documents: [{ id: "x" }],
    });
    await assert.rejects(
      encryptJsonToFile([plaintext], { outputPath, repoRoot: resolve("."), passphrase }),
      /já existe/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects output inside the repository, wrong passwords, and tampering", async () => {
  const insideRepository = resolve("tools/firestore-backup/test/unsafe.json.enc");
  await assert.rejects(
    encryptJsonToFile(["{}"], {
      outputPath: insideRepository,
      repoRoot: resolve("."),
      passphrase,
    }),
    /fora do repositório/
  );

  const missingDirectory = resolve(
    "tools/firestore-backup/test/not-created/backup.json.enc"
  );
  await assert.rejects(
    encryptJsonToFile(["{}"], {
      outputPath: missingDirectory,
      repoRoot: resolve("."),
      passphrase,
    }),
    /fora do repositório/
  );

  const directory = await mkdtemp(join(tmpdir(), "rc-backup-fixture-"));
  const outputPath = join(directory, "fixture.json.enc");

  try {
    await encryptJsonToFile(["{\"ok\":true}"], {
      outputPath,
      repoRoot: resolve("."),
      passphrase,
    });
    const encrypted = await readFile(outputPath);

    assert.throws(
      () => decryptBackupBuffer(encrypted, "wrong-fixture-passphrase"),
      /Unsupported state|authenticate|bad decrypt/i
    );

    const changed = Buffer.from(encrypted);
    changed[changed.length - 20] ^= 0x01;
    assert.throws(() => decryptBackupBuffer(changed, passphrase));

    const tamperedPath = join(directory, "tampered.json.enc");
    await writeFile(tamperedPath, changed);
    await assert.rejects(verifyEncryptedFile(tamperedPath, passphrase));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("removes incomplete encrypted output if the source fails midway", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rc-backup-fixture-"));
  const outputPath = join(directory, "incomplete.json.enc");

  async function* failingSource() {
    yield '{"documents":[';
    throw new Error("fixture read failure");
  }

  try {
    await assert.rejects(
      encryptJsonToFile(failingSource(), {
        outputPath,
        repoRoot: resolve("."),
        passphrase,
      }),
      /fixture read failure/
    );
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});