import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createBackupJson } from "./backup-core.mjs";
import { encryptJsonToFile } from "./crypto.mjs";
import { createFirestoreReader } from "./firestore-reader.mjs";

const USAGE = `Uso:
  npm run backup -- --project-id ID --output /caminho/backup.json.enc --live-read-confirmed (--writes-paused-confirmed | --accept-concurrent-writes-risk)

As credenciais devem vir de Application Default Credentials. A senha do arquivo
é solicitada sem eco no terminal. A confirmação de leitura real é obrigatória.`;

export function parseArguments(args) {
  const options = {
    databaseId: "(default)",
    liveReadConfirmed: false,
    writesPausedConfirmed: false,
    concurrentWritesRiskAccepted: false,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }

    if (argument === "--live-read-confirmed") {
      options.liveReadConfirmed = true;
      continue;
    }

    if (argument === "--writes-paused-confirmed") {
      options.writesPausedConfirmed = true;
      continue;
    }

    if (argument === "--accept-concurrent-writes-risk") {
      options.concurrentWritesRiskAccepted = true;
      continue;
    }

    const optionNames = new Map([
      ["--project-id", "projectId"],
      ["--database-id", "databaseId"],
      ["--output", "outputPath"],
    ]);
    const optionName = optionNames.get(argument);

    if (!optionName) throw new Error(`Opção desconhecida: ${argument}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Informe um valor para ${argument}.`);
    }

    options[optionName] = value;
    index += 1;
  }

  return options;
}

export function validateLiveOptions(options) {
  if (!options.liveReadConfirmed) {
    throw new Error(
      "Leitura real bloqueada. Obtenha autorização explícita antes de usar --live-read-confirmed."
    );
  }

  if (
    options.writesPausedConfirmed &&
    options.concurrentWritesRiskAccepted
  ) {
    throw new Error(
      "Escolha somente um modo: gravações pausadas ou aceite do risco de gravações simultâneas."
    );
  }

  if (!options.writesPausedConfirmed && !options.concurrentWritesRiskAccepted) {
    throw new Error(
      "Confirme gravações pausadas com --writes-paused-confirmed ou aceite explicitamente o risco com --accept-concurrent-writes-risk."
    );
  }

  if (!options.projectId) throw new Error("--project-id é obrigatório.");
  if (!options.outputPath) throw new Error("--output é obrigatório.");
  if (!options.outputPath.startsWith("/")) {
    throw new Error("--output deve ser um caminho absoluto fora do repositório.");
  }
  if (!options.outputPath.endsWith(".json.enc")) {
    throw new Error("--output deve terminar em .json.enc.");
  }
}

export function summarizeCollectionCounts(collectionCounts) {
  const summary = new Map();

  for (const [path, count] of Object.entries(collectionCounts)) {
    const pattern = path
      .split("/")
      .map((segment, index) => (index % 2 === 1 ? "{doc}" : segment))
      .join("/");
    summary.set(pattern, (summary.get(pattern) || 0) + count);
  }

  return Object.fromEntries([...summary.entries()].sort(([first], [second]) =>
    first.localeCompare(second)
  ));
}

export function readHiddenPassphrase(promptText) {
  const input = process.stdin;
  const output = process.stdout;

  if (!input.isTTY || typeof input.setRawMode !== "function") {
    return Promise.reject(
      new Error("A senha só pode ser solicitada em um terminal interativo seguro.")
    );
  }

  output.write(promptText);
  input.setRawMode(true);
  input.setEncoding("utf8");
  input.resume();

  return new Promise((resolvePassphrase, rejectPassphrase) => {
    let passphrase = "";

    function cleanup() {
      input.off("data", handleInput);
      input.setRawMode(false);
      input.pause();
      output.write("\n");
    }

    function handleInput(chunk) {
      for (const character of chunk) {
        if (character === "\u0003") {
          cleanup();
          rejectPassphrase(new Error("Leitura cancelada pelo operador."));
          return;
        }

        if (character === "\r" || character === "\n") {
          cleanup();
          resolvePassphrase(passphrase);
          return;
        }

        if (character === "\u007f" || character === "\b") {
          passphrase = Array.from(passphrase).slice(0, -1).join("");
          continue;
        }

        if (character >= " ") passphrase += character;
      }
    }

    input.on("data", handleInput);
  });
}

export function createImpersonatedAdcConfig(projectId, sourceCredentials) {
  if (!projectId || typeof projectId !== "string") {
    throw new Error("ID do projeto inválido para impersonação.");
  }

  if (
    sourceCredentials?.type !== "authorized_user" ||
    sourceCredentials.private_key
  ) {
    throw new Error(
      "A ADC de origem deve ser authorized_user e não conter chave privada."
    );
  }

  const serviceAccount =
    `rc-manager-firestore-backup@${projectId}.iam.gserviceaccount.com`;

  return {
    type: "impersonated_service_account",
    source_credentials: sourceCredentials,
    service_account_impersonation_url:
      `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${serviceAccount}:generateAccessToken`,
    delegates: [],
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  };
}

async function runLiveExport(options) {
  const sourceAdcPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    join(homedir(), ".config/gcloud/application_default_credentials.json");
  const sourceCredentials = JSON.parse(await readFile(sourceAdcPath, "utf8"));
  const impersonatedAdc = createImpersonatedAdcConfig(
    options.projectId,
    sourceCredentials
  );
  const { GoogleAuth } = await import("google-auth-library");
  const impersonatedClient = new GoogleAuth({
    scopes: impersonatedAdc.scopes,
  }).fromJSON(impersonatedAdc);
  const { token } = await impersonatedClient.getAccessToken();
  if (!token) throw new Error("A impersonação não retornou um token.");

  const passphrase = await readHiddenPassphrase("Senha de criptografia: ");
  const confirmation = await readHiddenPassphrase("Repita a senha: ");
  if (passphrase !== confirmation) throw new Error("As senhas não coincidem.");

  const temporaryCredentialDirectory = await mkdtemp(
    "/dev/shm/rc-manager-firestore-backup-"
  );
  const temporaryCredentialPath = join(
    temporaryCredentialDirectory,
    "application_default_credentials.json"
  );
  const previousApplicationCredentials =
    process.env.GOOGLE_APPLICATION_CREDENTIALS;
  let app;

  try {
    await writeFile(temporaryCredentialPath, JSON.stringify(impersonatedAdc), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    process.env.GOOGLE_APPLICATION_CREDENTIALS = temporaryCredentialPath;

    const [
      { applicationDefault, initializeApp, deleteApp },
      { FieldPath, getFirestore },
    ] = await Promise.all([
      import("firebase-admin/app"),
      import("firebase-admin/firestore"),
    ]);

    app = initializeApp(
      {
        credential: applicationDefault(),
        projectId: options.projectId,
      },
      "rc-firestore-local-backup"
    );

    const firestore =
      options.databaseId === "(default)"
        ? getFirestore(app)
        : getFirestore(app, options.databaseId);
    firestore.settings({ useBigInt: true });
    const reader = createFirestoreReader(firestore, FieldPath.documentId());
    const repoRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
    let manifest;

    const result = await encryptJsonToFile(
      createBackupJson(reader, {
        projectId: options.projectId,
        databaseId: options.databaseId,
        onManifest: (value) => {
          manifest = value;
        },
      }),
      {
        outputPath: options.outputPath,
        repoRoot,
        passphrase,
      }
    );

    console.log(`Backup criptografado: ${result.outputPath}`);
    console.log(`Documentos incluídos: ${manifest.documentCount}`);
    const summarizedCounts = summarizeCollectionCounts(manifest.collectionCounts);
    console.log(`Tipos de coleção/subcoleção: ${Object.keys(summarizedCounts).length}`);
    console.log(`Integridade AES-GCM validada: ${result.verified ? "sim" : "não"}`);
    console.log(`SHA-256 do arquivo: ${result.sha256}`);
    for (const [path, count] of Object.entries(summarizedCounts)) {
      console.log(`  ${path}: ${count}`);
    }
  } finally {
    if (app) await app.delete();
    if (previousApplicationCredentials === undefined) {
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    } else {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = previousApplicationCredentials;
    }
    await rm(temporaryCredentialDirectory, { recursive: true, force: true });
  }
}

export async function runCli(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  if (options.help) {
    console.log(USAGE);
    return;
  }

  validateLiveOptions(options);
  await runLiveExport(options);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  runCli().catch((error) => {
    console.error(`Backup não concluído: ${error.message}`);
    process.exitCode = 1;
  });
}