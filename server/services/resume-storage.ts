import { randomUUID } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { prisma } from "../lib/database";

const localDirectory = path.resolve(process.env.RESUME_LOCAL_DIR ?? ".private/resumes");

function storageMode(): "local" | "s3" | "database" {
  const configured = process.env.RESUME_STORAGE;
  if (configured && configured !== "local" && configured !== "s3" && configured !== "database") {
    throw new Error("RESUME_STORAGE must be local, s3, or database");
  }
  if (configured === "local") return "local";
  if (configured === "database") return "database";
  if (configured === "s3") {
    if (!process.env.RESUME_S3_BUCKET) {
      throw new Error("RESUME_S3_BUCKET is required when RESUME_STORAGE=s3");
    }
    return "s3";
  }
  if (process.env.RESUME_S3_BUCKET) return "s3";
  return process.env.NODE_ENV === "production" ? "database" : "local";
}

function isS3Configured() { return storageMode() === "s3"; }

function assertLocalStorageAvailable() {
  if (process.env.NODE_ENV === "production" && process.env.RESUME_STORAGE !== "local") {
    throw new Error("Configure private S3 storage, or set RESUME_STORAGE=local only when this server has a persistent private disk");
  }
}

async function s3Client() {
  const { S3Client } = await import("@aws-sdk/client-s3");
  const options: any = { region: process.env.AWS_REGION ?? "ap-south-1" };
  if (process.env.RESUME_S3_ENDPOINT) { options.endpoint = process.env.RESUME_S3_ENDPOINT; options.forcePathStyle = true; }
  return new S3Client(options);
}

function assertSafeKey(key: string) {
  if (!/^[a-f0-9-]+\.(pdf|docx)$/.test(key)) throw new Error("Invalid resume storage key");
}

export async function storeResume(bytes: Buffer, extension: "pdf" | "docx") {
  const key = `${randomUUID()}.${extension}`;
  if (isS3Configured()) {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await s3Client();
    await client.send(new PutObjectCommand({ Bucket: process.env.RESUME_S3_BUCKET!, Key: key, Body: bytes, ServerSideEncryption: "AES256", ContentType: extension === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
    return key;
  }
  if (storageMode() === "database") {
    await prisma.resumeFile.create({ data: { fileKey: key, content: Uint8Array.from(bytes) } });
    return key;
  }
  assertLocalStorageAvailable();
  await fs.mkdir(localDirectory, { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(localDirectory, key), bytes, { mode: 0o600, flag: "wx" });
  return key;
}

export async function loadResume(key: string): Promise<Buffer> {
  assertSafeKey(key);
  if (isS3Configured()) {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await s3Client();
    const result = await client.send(new GetObjectCommand({ Bucket: process.env.RESUME_S3_BUCKET!, Key: key }));
    if (!result.Body) throw new Error("Stored resume has no content");
    return Buffer.from(await result.Body.transformToByteArray());
  }
  if (storageMode() === "database") {
    const file = await prisma.resumeFile.findUnique({ where: { fileKey: key }, select: { content: true } });
    if (!file) throw new Error("Stored resume file was not found");
    return Buffer.from(file.content);
  }
  assertLocalStorageAvailable();
  return fs.readFile(path.join(localDirectory, key));
}

export async function openResume(key: string): Promise<{ stream?: Readable; url?: string }> {
  assertSafeKey(key);
  if (isS3Configured()) {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
    const client = await s3Client();
    const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: process.env.RESUME_S3_BUCKET!, Key: key }), { expiresIn: 60 });
    return { url };
  }
  if (storageMode() === "database") {
    return { stream: Readable.from(await loadResume(key)) };
  }
  assertLocalStorageAvailable();
  return { stream: createReadStream(path.join(localDirectory, key)) };
}

export async function deleteResumeFile(key: string) {
  assertSafeKey(key);
  if (isS3Configured()) {
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await s3Client();
    await client.send(new DeleteObjectCommand({ Bucket: process.env.RESUME_S3_BUCKET!, Key: key }));
  } else if (storageMode() === "database") {
    await prisma.resumeFile.deleteMany({ where: { fileKey: key } });
  } else {
    assertLocalStorageAvailable();
    await fs.rm(path.join(localDirectory, key), { force: true });
  }
}
