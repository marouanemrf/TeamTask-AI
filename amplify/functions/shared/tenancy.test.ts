import { describe, expect, it, vi } from "vitest";
import { isOrganisationBackfill } from "../audit-archive/handler";
import { assertSameOrganisation, forManagers, managersGroupOf, organisationFromGroups, organisationGroupsFor, requireOrganisation } from "./tenancy";

vi.mock("@aws-sdk/client-s3", () => ({ S3Client: class {}, PutObjectCommand: class {} }));

const ORG = "94fb95a9-666b-4afa-99c5-41961ba0b27c";
const OTHER = "11111111-2222-4333-8444-555555555555";

describe("organisation groups", () => {
  it("puts managers in the managers group, other roles only in the organisation group", () => {
    expect(organisationGroupsFor(ORG, ["ADMIN"])).toEqual([ORG, `${ORG}:MANAGERS`]);
    expect(organisationGroupsFor(ORG, ["PROJECT_MANAGER", "MEMBER"])).toEqual([ORG, `${ORG}:MANAGERS`]);
    expect(organisationGroupsFor(ORG, ["MEMBER"])).toEqual([ORG]);
    expect(organisationGroupsFor(ORG, ["VIEWER"])).toEqual([ORG]);
    expect(forManagers(ORG)).toEqual({ organisationId: ORG, managersGroup: managersGroupOf(ORG) });
  });

  it("reads the organisation from the token groups, ignoring roles and the managers group", () => {
    expect(organisationFromGroups(["ADMIN", ORG, `${ORG}:MANAGERS`])).toBe(ORG);
    expect(organisationFromGroups(["MEMBER"])).toBeUndefined();
    expect(organisationFromGroups(undefined)).toBeUndefined();
    // Two organisations: ambiguous, so none (never pick one).
    expect(organisationFromGroups([ORG, OTHER])).toBeUndefined();
  });
});

describe("tenant boundary checks", () => {
  it("refuses a caller without an organisation", () => {
    expect(() => requireOrganisation({})).toThrow(/organisation/);
    expect(requireOrganisation({ organisationId: ORG })).toBe(ORG);
  });

  it("reports a record of another organisation (or of none) as not found", () => {
    expect(() => assertSameOrganisation({ organisationId: ORG }, ORG, "This task")).not.toThrow();
    expect(() => assertSameOrganisation({ organisationId: OTHER }, ORG, "This task")).toThrow(/doesn't exist/);
    expect(() => assertSameOrganisation({ organisationId: null }, ORG, "This task")).toThrow(/doesn't exist/);
    expect(() => assertSameOrganisation(null, ORG, "This task")).toThrow(/doesn't exist/);
  });
});

describe("audit archive: organisation backfill vs tampering", () => {
  const old = { id: { S: "e1" }, eventType: { S: "CREATED" }, after: { M: { status: { S: "TODO" } } } };

  it("treats a change that only adds organisationId as the migration", () => {
    expect(isOrganisationBackfill({ eventName: "MODIFY", dynamodb: { OldImage: old, NewImage: { ...old, organisationId: { S: ORG } } } })).toBe(true);
  });

  it("treats any other change as tampering", () => {
    expect(isOrganisationBackfill({ eventName: "MODIFY", dynamodb: { OldImage: old, NewImage: { ...old, organisationId: { S: ORG }, eventType: { S: "DELETED" } } } })).toBe(false);
    expect(isOrganisationBackfill({ eventName: "MODIFY", dynamodb: { OldImage: { ...old, organisationId: { S: OTHER } }, NewImage: { ...old, organisationId: { S: ORG } } } })).toBe(false);
    expect(isOrganisationBackfill({ eventName: "REMOVE", dynamodb: { OldImage: old } })).toBe(false);
  });
});
