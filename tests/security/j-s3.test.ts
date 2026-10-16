import { describe, expect, it } from "vitest";
import { CognitoIdentityClient, GetCredentialsForIdentityCommand, GetIdCommand } from "@aws-sdk/client-cognito-identity";
import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { enabled, fx, idToken, record } from "./helpers";
import type { UserKey } from "./helpers";

/** S3 client signed with the user's identity-pool credentials (what the browser gets). */
async function s3As(key: UserKey): Promise<{ s3: S3Client; identityId: string }> {
  const ci = new CognitoIdentityClient({ region: fx.region });
  const logins = { [`cognito-idp.${fx.region}.amazonaws.com/${fx.userPoolId}`]: await idToken(key) };
  const { IdentityId } = await ci.send(new GetIdCommand({ IdentityPoolId: fx.identityPoolId, Logins: logins }));
  const { Credentials } = await ci.send(new GetCredentialsForIdentityCommand({ IdentityId, Logins: logins }));
  return {
    identityId: IdentityId!,
    s3: new S3Client({ region: fx.region, credentials: { accessKeyId: Credentials!.AccessKeyId!, secretAccessKey: Credentials!.SecretKey!, sessionToken: Credentials!.SessionToken! } }),
  };
}
const attempt = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return "allowed";
  } catch (error) {
    return `denied (${(error as { name?: string }).name ?? "error"})`;
  }
};

describe.skipIf(!enabled)("j. S3 (profile photo bucket — the only bucket deployed)", () => {
  it("anonymous access to the bucket is denied (list and get)", async () => {
    const base = `https://${fx.bucket}.s3.${fx.region}.amazonaws.com`;
    const list = await fetch(`${base}/?list-type=2`);
    const get = await fetch(`${base}/avatars/does-not-matter.webp`);
    const pass = list.status === 403 && get.status === 403;
    record({ category: "j. S3", name: "public access", request: "unsigned GET bucket list + object", expected: "403", actual: `list ${list.status}, get ${get.status}`, pass });
    expect(pass).toBe(true);
  });

  it("a user cannot write into another user's photo folder or the managers' folder", async () => {
    const { s3 } = await s3As("A_MEMBER");
    const { identityId: other } = await s3As("A_VIEWER");
    const foreign = await attempt(() => s3.send(new PutObjectCommand({ Bucket: fx.bucket, Key: `profile-avatars/${other}/sec.webp`, Body: "x", ContentType: "image/webp" })));
    const managers = await attempt(() => s3.send(new PutObjectCommand({ Bucket: fx.bucket, Key: "avatars/sec-member.webp", Body: "x", ContentType: "image/webp" })));
    const pass = foreign.startsWith("denied") && managers.startsWith("denied");
    record({ category: "j. S3", name: "write outside own folder", request: "PutObject profile-avatars/<other identity>/ and avatars/ as MEMBER", expected: "denied", actual: `other folder: ${foreign}; avatars/: ${managers}`, pass });
    expect(pass).toBe(true);
  });

  it("org B cannot read org A photos", async () => {
    const { s3: s3A } = await s3As("A_ADMIN");
    const listed = await s3A.send(new ListObjectsV2Command({ Bucket: fx.bucket, Prefix: "avatars/", MaxKeys: 1 }));
    const key = listed.Contents?.[0]?.Key;
    const { s3 } = await s3As("B_PM");
    const read = key ? await attempt(() => s3.send(new GetObjectCommand({ Bucket: fx.bucket, Key: key }))) : "no org A photo to test";
    const pass = read.startsWith("denied") || !key;
    record({ category: "j. S3", name: "cross-tenant photo read", request: `GetObject ${key ?? "-"} as org B PM`, expected: "denied", actual: read, pass, na: !key });
    expect(pass).toBe(true);
  });

  it("uploads of a forbidden type or over 20 MB are rejected", async () => {
    const { s3, identityId } = await s3As("A_MEMBER");
    const exe = `profile-avatars/${identityId}/sec-test.exe`;
    const big = `profile-avatars/${identityId}/sec-big.webp`;
    const typeResult = await attempt(() => s3.send(new PutObjectCommand({ Bucket: fx.bucket, Key: exe, Body: Buffer.from("MZ fake executable"), ContentType: "application/x-msdownload" })));
    const sizeResult = await attempt(() => s3.send(new PutObjectCommand({ Bucket: fx.bucket, Key: big, Body: Buffer.alloc(21 * 1024 * 1024), ContentType: "image/webp" })));
    for (const k of [exe, big]) await attempt(() => s3.send(new DeleteObjectCommand({ Bucket: fx.bucket, Key: k })));
    const pass = typeResult.startsWith("denied") && sizeResult.startsWith("denied");
    record({ category: "j. S3", name: "forbidden type / size on upload", request: "PutObject .exe and a 21 MB file into the user's own folder", expected: "rejected", actual: `exe: ${typeResult}; 21 MB: ${sizeResult}`, pass });
    expect(pass).toBe(true);
  }, 120_000);

  it("attachments with presigned URLs", () => {
    record({ category: "j. S3", name: "presigned attachment URL of another org", request: "—", expected: "denied", actual: "NOT RUN: task attachments (presigned URLs, KMS bucket) are not deployed yet (phase 5)", pass: true, na: true });
    expect(true).toBe(true);
  });
});
