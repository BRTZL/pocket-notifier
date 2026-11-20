import { oc } from "@orpc/contract";
import { z } from "zod";

import { PageInput, pageOf, UserSummary } from "./common";
import { ConversationSummary, GetConversationInput, ListConversationsInput } from "./conversation";
import { Device, DeviceId, RegisterDeviceInput, RenameDeviceInput } from "./device";
import { ERRORS } from "./errors";
import {
  CreateFeatureInput,
  Feature,
  ListFeaturesInput,
  UpdateFeatureStatusInput,
} from "./feature";
import {
  CreateInviteInput,
  CreateInviteOutput,
  Invite,
  InviteCode,
  InviteId,
  InvitePreview,
} from "./invite";
import {
  InboxMessage,
  ListMessagesInput,
  MarkReadInput,
  MessageId,
  PublishInput,
  PublishOutput,
} from "./message";
import {
  AddMemberInput,
  CreateProjectInput,
  MyProject,
  ProjectId,
  ProjectMember,
  SubscriptionInput,
  UpdateMemberInput,
  UpdateProjectInput,
} from "./project";
import { CreateResponseInput, MessageResponse } from "./response";
import { AccessToken, CreateTokenInput, CreateTokenOutput, TokenId } from "./token";

/**
 * App API for the web dashboard and the mobile app, over oRPC at `/rpc`.
 * Authenticated with the better-auth session; every procedure except
 * `invites.preview` requires one.
 */
const authed = oc.errors({
  UNAUTHORIZED: ERRORS.UNAUTHORIZED,
  FORBIDDEN: ERRORS.FORBIDDEN,
  NOT_FOUND: ERRORS.NOT_FOUND,
});

const Ok = z.object({ ok: z.literal(true) });
const ById = <T extends z.ZodType>(id: T) => z.object({ id });

export const appContract = {
  me: {
    get: authed.output(UserSummary),
  },

  projects: {
    list: authed.output(z.array(MyProject)),
    get: authed.input(ById(ProjectId)).output(MyProject),
    create: authed
      .errors({ CONFLICT: ERRORS.CONFLICT })
      .input(CreateProjectInput)
      .output(MyProject),
    update: authed.input(UpdateProjectInput).output(MyProject),
    delete: authed.input(ById(ProjectId)).output(Ok),
    setSubscription: authed.input(SubscriptionInput).output(MyProject),
  },

  features: {
    /** A project's features (a feature is a conversation in the app), newest activity first. */
    list: authed.input(ListFeaturesInput).output(z.array(Feature)),
    /** Owners and publishers. Idempotent by slug: an existing slug returns that feature. */
    create: authed.input(CreateFeatureInput).output(Feature),
    /** Owners only. */
    updateStatus: authed.input(UpdateFeatureStatusInput).output(Feature),
  },

  members: {
    list: authed.input(z.object({ projectId: ProjectId })).output(z.array(ProjectMember)),
    add: authed.errors({ CONFLICT: ERRORS.CONFLICT }).input(AddMemberInput).output(ProjectMember),
    update: authed.input(UpdateMemberInput).output(ProjectMember),
    remove: authed.input(z.object({ projectId: ProjectId, userId: z.string().min(1) })).output(Ok),
  },

  conversations: {
    /**
     * The chat-style inbox: one row per conversation in the caller's projects, ordered by
     * last message, newest first.
     */
    list: authed.input(ListConversationsInput).output(pageOf(ConversationSummary)),
    /** One conversation's row; NOT_FOUND when it has no visible message for the caller. */
    get: authed.input(GetConversationInput).output(ConversationSummary),
  },

  messages: {
    /**
     * The combined inbox, or one project when `projectId` is set, or one conversation when
     * `conversation` is set. Newest first.
     */
    list: authed.input(ListMessagesInput).output(pageOf(InboxMessage)),
    get: authed.input(ById(MessageId)).output(InboxMessage),
    markRead: authed.input(MarkReadInput).output(z.object({ updated: z.number().int() })),
    /** Same as the public publish endpoint, for "send test message" in the apps. */
    publish: authed
      .errors({ TOO_MANY_REQUESTS: ERRORS.TOO_MANY_REQUESTS })
      .input(PublishInput)
      .output(PublishOutput),
    delete: authed.input(ById(MessageId)).output(Ok),
  },

  responses: {
    create: authed
      .errors({ CONFLICT: ERRORS.CONFLICT })
      .input(CreateResponseInput)
      .output(MessageResponse),
    list: authed.input(PageInput.extend({ messageId: MessageId })).output(pageOf(MessageResponse)),
  },

  tokens: {
    list: authed.output(z.array(AccessToken)),
    create: authed.input(CreateTokenInput).output(CreateTokenOutput),
    revoke: authed.input(ById(TokenId)).output(Ok),
  },

  invites: {
    list: authed.output(z.array(Invite)),
    create: authed.input(CreateInviteInput).output(CreateInviteOutput),
    revoke: authed.input(ById(InviteId)).output(Ok),
    /** No session needed: shown on the sign-up page of an invite link. */
    preview: oc
      .errors({ NOT_FOUND: ERRORS.NOT_FOUND })
      .input(z.object({ code: InviteCode }))
      .output(InvitePreview),
  },

  devices: {
    list: authed.output(z.array(Device)),
    register: authed.input(RegisterDeviceInput).output(Device),
    rename: authed.input(RenameDeviceInput).output(Device),
    remove: authed.input(ById(DeviceId)).output(Ok),
  },
};

export type AppContract = typeof appContract;
