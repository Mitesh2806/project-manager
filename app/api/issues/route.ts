import { type NextRequest, NextResponse } from "next/server";
import { prisma, ratelimit } from "@/server/db";
import {
  IssueType,
  type Issue,
  IssueStatus,
  type DefaultUser,
} from "@prisma/client";
import { z } from "zod";
import { getAuth } from "@clerk/nextjs/server";
import {
  calculateInsertPosition,
  filterUserForClient,
  generateIssuesForClient,
} from "@/utils/helpers";
import { clerkClient } from "@clerk/nextjs";

const postIssuesBodyValidator = z.object({
  name: z.string(),
  type: z.enum(["BUG", "STORY", "TASK", "EPIC", "SUBTASK"]),
  sprintId: z.string().nullable(),
  reporterId: z.string().nullable(),
  parentId: z.string().nullable(),
  sprintColor: z.string().nullable().optional(),
});

export type PostIssueBody = z.infer<typeof postIssuesBodyValidator>;

const patchIssuesBodyValidator = z.object({
  ids: z.array(z.string()),
  type: z.nativeEnum(IssueType).optional(),
  status: z.nativeEnum(IssueStatus).optional(),
  assigneeId: z.string().nullable().optional(),
  reporterId: z.string().optional(),
  parentId: z.string().nullable().optional(),
  sprintId: z.string().nullable().optional(),
  isDeleted: z.boolean().optional(),
});

export type PatchIssuesBody = z.infer<typeof patchIssuesBodyValidator>;

type IssueT = Issue & {
  children: IssueT[];
  sprintIsActive: boolean;
  parent: Issue & {
    sprintIsActive: boolean;
    children: IssueT[];
    parent: null;
    assignee: DefaultUser | null;
    reporter: DefaultUser | null;
  };
  assignee: DefaultUser | null;
  reporter: DefaultUser | null;
};

export type GetIssuesResponse = {
  issues: IssueT[];
};

export async function GET(req: NextRequest) {
  const { userId } = getAuth(req);

  const activeIssues = await prisma.issue.findMany({
    where: {
      creatorId: userId ?? "init",
      isDeleted: false,
    },
  });

  if (!activeIssues || activeIssues.length === 0) {
    return NextResponse.json({ issues: [] });
  }

  const activeSprints = await prisma.sprint.findMany({
    where: {
      status: "ACTIVE",
    },
  });

  const userIds = activeIssues
    .flatMap((issue) => [issue.assigneeId, issue.reporterId] as string[])
    .filter(Boolean);

  
//  const users = await prisma.defaultUser.findMany({
//      where: {
//        id: {
//         in: userIds,
//       },
//      },
//    });
  
   const users = (
     await clerkClient.users.getUserList({
      userId: userIds,
      limit: 10,
   })
   ).map(filterUserForClient);
   

  const issuesForClient = generateIssuesForClient(
    activeIssues,
    users,
    activeSprints.map((sprint) => sprint.id)
  );

  // const issuesForClient = await getIssuesFromServer();
  return NextResponse.json({ issues: issuesForClient });
}

// POST
export async function PATCH(req: NextRequest) {
  const { userId } = getAuth(req);
  if (!userId) return new Response("Unauthenticated request", { status: 403 });

  const { success } = await ratelimit.limit(userId);
  if (!success) return new Response("Too many requests", { status: 429 });

  // Parse and validate the request body
  const body = await req.json();
  const validated = patchIssuesBodyValidator.safeParse(body);

  if (!validated.success) {
    return new Response("Invalid body.", { status: 400 });
  }

  const { data: valid } = validated;

  // Retrieve users from Clerk based on assigneeId (if provided)
  let assigneeUser = null;
  if (valid.assigneeId) {
    const users = await clerkClient.users.getUserList({
      userId: [valid.assigneeId],  // Fetch user by Clerk's user ID
    });
    assigneeUser = users.length > 0 ? users[0] : null;
    if (!assigneeUser) {
      return new Response("Assignee not found in Clerk", { status: 404 });
    }
  }

  // Fetch issues to update from Prisma based on IDs in the request
  const issuesToUpdate = await prisma.issue.findMany({
    where: {
      id: {
        in: valid.ids,
      },
    },
  });

  // Update the issues with the new data, including assigneeId
  const updatedIssues = await Promise.all(
    issuesToUpdate.map(async (issue) => {
      return await prisma.issue.update({
        where: {
          id: issue.id,
        },
        data: {
          type: valid.type ?? undefined,
          status: valid.status ?? undefined,
          assigneeId: assigneeUser ? assigneeUser.id : undefined,  // Assign Clerk's user ID
          reporterId: valid.reporterId ?? undefined,
          isDeleted: valid.isDeleted ?? undefined,
          sprintId: valid.sprintId === undefined ? undefined : valid.sprintId,
          parentId: valid.parentId ?? undefined,
        },
      });
    })
  );

  // Return the updated issues
  return NextResponse.json({ issues: updatedIssues });
}
