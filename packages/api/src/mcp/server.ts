/**
 * The notifier MCP server: tools agents use to keep projects and features and to send
 * notifications to the user's phone. One instance is built per request for the signed-in
 * user (see `./handler`), so nothing is shared between users.
 */

import { type CallToolResult, McpServer } from "@modelcontextprotocol/server";
import {
  FEATURE_LIMITS,
  FeatureSlug,
  FeatureStatus,
  type Feature as FeatureView,
} from "@notifier/contract/feature";
import { MESSAGE_LIMITS, OpenableUrl, Tag } from "@notifier/contract/message";
import { Priority } from "@notifier/contract/priority";
import { TopicName } from "@notifier/contract/topic";
import type { Database } from "@notifier/db";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import type { Dispatch } from "../dispatch";
import {
  createFeature,
  createProject,
  findFeature,
  findProject,
  listFeatures,
  listProjects,
  type ProjectAccess,
  projectNotFound,
  resolveSendTarget,
  sendNotification,
  toFeature,
  updateFeatureStatus,
} from "../lib/projects";
import { MCP_INSTRUCTIONS } from "./instructions";

export const MCP_SERVER_INFO = { name: "pocket-notifier", version: "1.0.0" } as const;

export type McpCaller = {
  db: Database;
  userId: string;
  /** Who sends: the OAuth client, e.g. `{ id: <client_id>, name: "Claude Code" }`. */
  sender: { id: string; name?: string };
  dispatch: Dispatch;
};

const ProjectRef = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .describe(
    'Project name as listed by list_projects, e.g. "rezme". "general" is your private General project.',
  );
const FeatureRef = z
  .string()
  .trim()
  .min(1)
  .max(FEATURE_LIMITS.nameLength)
  .describe('Feature slug or name, e.g. "improving-performance" or "Improving performance".');

type ToolResult = CallToolResult;

function ok(text: string, structured: Record<string, unknown>): ToolResult {
  return { content: [{ type: "text", text }], structuredContent: structured };
}

function fail(text: string): ToolResult {
  return { isError: true, content: [{ type: "text", text }] };
}

/** Runs a tool body; domain errors become readable tool errors instead of protocol errors. */
async function run(body: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await body();
  } catch (error) {
    if (error instanceof ORPCError) {
      return fail(error.message);
    }
    console.error("mcp tool failed", error);
    return fail("Internal error in Pocket Notifier. Try again later.");
  }
}

function featureView(feature: FeatureView) {
  return {
    slug: feature.slug,
    name: feature.name,
    description: feature.description,
    status: feature.status,
    lastMessageAt: feature.lastMessageAt,
  };
}

function featureLine(feature: FeatureView): string {
  return `- ${feature.slug} "${feature.name}" (${feature.status})`;
}

async function projectOrFail(caller: McpCaller, name: string): Promise<ProjectAccess> {
  const access = await findProject(caller.db, caller.userId, name);
  if (!access) {
    throw projectNotFound(name);
  }
  return access;
}

function registerProjectTools(server: McpServer, caller: McpCaller) {
  server.registerTool(
    "list_projects",
    {
      title: "List projects",
      description:
        "List the user's Pocket Notifier projects (one per product or repo) with your role and feature counts. Call this before sending to check the project exists. isGeneral marks the private General project that takes notifications sent without a project.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    () =>
      run(async () => {
        const projects = (await listProjects(caller.db, caller.userId)).map((project) => ({
          name: project.name,
          displayName: project.displayName,
          description: project.description,
          role: project.role,
          isGeneral: project.personal,
          features: project.featureCounts,
        }));
        const lines = projects.map(
          (project) =>
            `- ${project.name}${project.displayName ? ` "${project.displayName}"` : ""} (${project.role}${project.isGeneral ? ", private General project" : ""}): ${project.features.active} active, ${project.features.done} done features`,
        );
        return ok(`Projects:\n${lines.join("\n")}`, { projects });
      }),
  );

  server.registerTool(
    "create_project",
    {
      title: "Create project",
      description:
        'Create a project for a product or repo, owned by the user. Idempotent: if you already own or publish to a project with this name it is returned unchanged. If the name belongs to someone else you get an error and should pick another name (e.g. add a suffix like "rezme-app").',
      inputSchema: z.object({
        name: TopicName.describe(
          'Lowercase name: letters, digits, "-" or "_", e.g. the repo name "rezme". Unique across the server.',
        ),
        displayName: z
          .string()
          .trim()
          .min(1)
          .max(80)
          .optional()
          .describe('Shown in the app, e.g. "Rezme".'),
        description: z.string().max(500).optional(),
      }),
    },
    ({ name, displayName, description }) =>
      run(async () => {
        const { project, created } = await createProject(caller.db, caller.userId, {
          name,
          displayName,
          description,
        });
        return ok(
          created
            ? `Created project ${project.name}.`
            : `Project ${project.name} already exists; using it.`,
          {
            created,
            project: {
              name: project.name,
              displayName: project.displayName,
              description: project.description,
              role: project.role,
              isGeneral: project.personal,
            },
          },
        );
      }),
  );
}

function registerFeatureTools(server: McpServer, caller: McpCaller) {
  server.registerTool(
    "list_features",
    {
      title: "List features",
      description:
        "List a project's features (workstreams; each is a chat thread in the app), most recent activity first. Reuse a matching feature instead of creating a near-duplicate.",
      inputSchema: z.object({
        project: ProjectRef,
        status: z
          .enum(["active", "done", "archived", "all"])
          .default("active")
          .describe('Which features to list. Default "active".'),
      }),
      annotations: { readOnlyHint: true },
    },
    ({ project, status }) =>
      run(async () => {
        const access = await projectOrFail(caller, project);
        const rows = await listFeatures(
          caller.db,
          access.topic.id,
          status === "all" ? undefined : status,
        );
        const features = rows.map(toFeature);
        const text =
          features.length === 0
            ? `No ${status === "all" ? "" : `${status} `}features in ${access.topic.name}.`
            : `Features in ${access.topic.name}:\n${features.map(featureLine).join("\n")}`;
        return ok(text, { project: access.topic.name, features: features.map(featureView) });
      }),
  );

  server.registerTool(
    "create_feature",
    {
      title: "Create feature",
      description:
        'Create a feature (a workstream, e.g. "Improving performance") in a project. Idempotent by slug: the slug is derived from the name unless given, and an existing feature with that slug is returned unchanged. Needs owner or publisher access.',
      inputSchema: z.object({
        project: ProjectRef,
        name: z
          .string()
          .trim()
          .min(1)
          .max(FEATURE_LIMITS.nameLength)
          .describe("Short human name, shown as the thread title."),
        slug: FeatureSlug.optional().describe('Optional stable id, e.g. "improving-performance".'),
        description: z.string().max(FEATURE_LIMITS.descriptionLength).optional(),
      }),
    },
    ({ project, name, slug, description }) =>
      run(async () => {
        const access = await projectOrFail(caller, project);
        const result = await createFeature(caller.db, {
          access,
          userId: caller.userId,
          name,
          slug,
          description,
        });
        const view = toFeature(result.feature);
        return ok(
          `${result.created ? "Created" : "Using existing"} feature ${view.slug} "${view.name}" in ${access.topic.name}.`,
          { created: result.created, project: access.topic.name, feature: featureView(view) },
        );
      }),
  );

  server.registerTool(
    "update_feature_status",
    {
      title: "Update feature status",
      description:
        'Mark a feature "done" when its workstream is finished, "archived" to put it away, or "active" again. Only the project owner can change status. Sending a notification never changes it.',
      inputSchema: z.object({
        project: ProjectRef,
        feature: FeatureRef,
        status: FeatureStatus,
      }),
      annotations: { idempotentHint: true },
    },
    ({ project, feature: ref, status }) =>
      run(async () => {
        const access = await projectOrFail(caller, project);
        const found = await findFeature(caller.db, access.topic.id, ref);
        if (!found) {
          return fail(
            `Feature '${ref}' not found in project '${access.topic.name}'. Call list_features with status "all".`,
          );
        }
        const view = toFeature(await updateFeatureStatus(caller.db, access, found.id, status));
        return ok(`Feature ${view.slug} is now ${view.status}.`, {
          project: access.topic.name,
          feature: featureView(view),
        });
      }),
  );
}

const SendInput = z.object({
  project: ProjectRef.optional().describe(
    'Project name, e.g. "rezme". Omit to send to your private General project.',
  ),
  feature: FeatureRef.optional().describe(
    "Feature (workstream) slug or name. Matched by slug, then by name; if none matches, a feature with this name is created.",
  ),
  title: z
    .string()
    .trim()
    .min(1)
    .max(MESSAGE_LIMITS.titleLength)
    .describe(
      'The outcome in at most 32 characters, e.g. "Login flow done" or "Need a decision: DB".',
    ),
  body: z
    .string()
    .max(MESSAGE_LIMITS.bodyLength)
    .optional()
    .describe("One line: result first, the user's next step last."),
  priority: Priority.optional().describe(
    "1 min, 2 low (FYI), 3 normal (default: task done), 4 high (blocked, needs a decision), 5 urgent (production or data at risk).",
  ),
  tags: z.array(Tag).max(MESSAGE_LIMITS.tags).optional().describe('Single-word tags, e.g. ["ci"].'),
  url: OpenableUrl.optional().describe(
    "Opened when the notification is tapped, e.g. the PR or deploy URL.",
  ),
  ask: z
    .object({
      question: z
        .string()
        .trim()
        .min(1)
        .max(500)
        .optional()
        .describe("The question, appended to the body."),
      quickReplies: z
        .array(z.string().trim().min(1).max(MESSAGE_LIMITS.quickReplyLength))
        .max(MESSAGE_LIMITS.quickReplies)
        .optional()
        .describe('Up to 3 one-tap answers, e.g. ["Yes", "No"].'),
      allowText: z.boolean().optional().describe("Let the user type an answer. Default true."),
    })
    .optional()
    .describe(
      "Use when blocked on a decision: adds a reply action. Replies are not readable through this server yet.",
    ),
  actions: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(MESSAGE_LIMITS.actionLabelLength),
        url: OpenableUrl,
      }),
    )
    .max(2)
    .optional()
    .describe('Up to 2 link buttons, e.g. [{ label: "Open PR", url: "https://..." }].'),
});

function registerSendTool(server: McpServer, caller: McpCaller) {
  server.registerTool(
    "send_notification",
    {
      title: "Send notification",
      description:
        "Send a push notification to the user's phone: when a task is done and verified, when you are blocked on a decision (use ask), on a failure you cannot fix, or when a long task finished. Not for progress updates. Never include secrets. Goes to the project's feature thread; without project it goes to General.",
      inputSchema: SendInput,
    },
    (input) =>
      run(async () => {
        const target = await resolveSendTarget(caller.db, caller.userId, {
          project: input.project,
          feature: input.feature,
        });
        const { message, deliveredTo } = await sendNotification(caller.db, {
          access: target.access,
          userId: caller.userId,
          feature: target.feature,
          dispatch: caller.dispatch,
          input: {
            title: input.title,
            body: input.body,
            priority: input.priority,
            tags: input.tags,
            url: input.url,
            ask: input.ask,
            links: input.actions,
            sender: caller.sender,
          },
        });
        const project = target.access.topic.name;
        const feature = target.feature
          ? { slug: target.feature.slug, name: target.feature.name, created: target.featureCreated }
          : null;
        const where = feature ? `${project} / ${feature.slug}` : project;
        return ok(
          `Sent ${message.id} to ${where}${feature?.created ? " (new feature)" : ""}; ${deliveredTo} device(s) subscribed.`,
          {
            messageId: message.id,
            project,
            isGeneral: target.access.topic.personalUserId !== null,
            feature,
            deliveredTo,
          },
        );
      }),
  );
}

/** A fresh MCP server for one request of `caller`. */
export function createNotifierMcpServer(caller: McpCaller): McpServer {
  const server = new McpServer(MCP_SERVER_INFO, {
    instructions: MCP_INSTRUCTIONS,
    capabilities: { tools: {} },
  });
  registerProjectTools(server, caller);
  registerFeatureTools(server, caller);
  registerSendTool(server, caller);
  return server;
}
