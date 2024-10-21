import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db";
// import { clerkClient } from "@clerk/nextjs/server";
// import { filterUserForClient } from "@/utils/helpers";
import { type DefaultUser } from "@prisma/client";
import { clerkClient } from "@clerk/nextjs";
import { filterUserForClient } from "@/utils/helpers";

export type GetProjectMembersResponse = {
  members: DefaultUser[];
};

type MembersParams = {
  params: {
    project_id: string;
  };
};

export async function GET(req: NextRequest, { params }: MembersParams) {
  const { project_id } = params;
  const members = await prisma.member.findMany({
    where: {
      projectId: project_id,
    },
  });

   
  // const users = await prisma.defaultUser.findMany({
  //   where: {
  //     id: {
  //        in: members.map((member) => member.id),
  //    },
  //   },
  //  });
 

  // // COMMENT THIS IF RUNNING LOCALLY ------------------
  const users = (
    await clerkClient.users.getUserList({
      limit: 100,  // adjust limit as per your needs
    })
  ).map(filterUserForClient);

  // Filter the Clerk users based on project membership (from members list)
  const projectMembers = users.filter((user) =>
    members.some((member) => member.id === user.id)
  );
  // // --------------------------------------------------

  // return NextResponse.json<GetProjectMembersResponse>({ members:users });
  return NextResponse.json({ members: projectMembers });
}
