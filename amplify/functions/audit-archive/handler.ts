import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

/**
 * Immutable copy of the business audit log. Every change of the TaskEvent table (DynamoDB stream)
 * is written to the audit archive bucket, which has S3 Object Lock: objects can't be changed or
 * deleted during the retention period, even by an administrator of the application. An INSERT is a
 * new audit event; a MODIFY or REMOVE should never happen (the log is append-only) and is archived
 * too, so any tampering with the table stays visible.
 */
interface StreamRecord {
  eventID?: string;
  eventName?: "INSERT" | "MODIFY" | "REMOVE";
  dynamodb?: { ApproximateCreationDateTime?: number; Keys?: unknown; NewImage?: unknown; OldImage?: unknown; SequenceNumber?: string };
}

const s3 = new S3Client({});

export const handler = async (event: { Records?: StreamRecord[] }) => {
  for (const record of event.Records ?? []) {
    const at = new Date((record.dynamodb?.ApproximateCreationDateTime ?? Date.now() / 1000) * 1000);
    const day = at.toISOString().slice(0, 10).replace(/-/g, "/");
    const kind = record.eventName === "INSERT" ? "events" : "tampering";
    const key = `task-events/${kind}/${day}/${record.dynamodb?.SequenceNumber ?? record.eventID}.json`;
    await s3.send(new PutObjectCommand({
      Bucket: process.env.ARCHIVE_BUCKET!,
      Key: key,
      ContentType: "application/json",
      Body: JSON.stringify({ archivedAt: new Date().toISOString(), eventName: record.eventName, eventID: record.eventID, keys: record.dynamodb?.Keys, newImage: record.dynamodb?.NewImage, oldImage: record.dynamodb?.OldImage }),
      // Object Lock needs an integrity checksum on every write.
      ChecksumAlgorithm: "SHA256",
    }));
    if (kind === "tampering") console.warn(JSON.stringify({ fn: "audit-archive", alert: "AUDIT_EVENT_CHANGED", eventName: record.eventName, key }));
  }
  return { archived: event.Records?.length ?? 0 };
};
