import type { Attachment } from "@notifier/contract/message";
import { Image } from "expo-image";
import { useVideoPlayer, VideoView } from "expo-video";
import { Button, cn, PressableFeedback, Typography, useToast } from "heroui-native";
import { useState } from "react";
import { Modal, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon, type IconName } from "@/components/icon";
import { errorMessage } from "@/lib/errors";
import { fileSize } from "@/lib/format";
import { openAttachmentUrl, UnopenableLinkError } from "@/lib/open-url";

/**
 * Inline media keeps a fixed frame: the API sends no dimensions, and a bubble that grows
 * once its image loads makes the (inverted) thread jump.
 */
const MEDIA_FRAME = "h-[200px] w-full";

function useOpenAttachment() {
  const { toast } = useToast();
  return (attachment: Attachment) => {
    openAttachmentUrl(attachment.url).catch((error: unknown) => {
      toast.show({
        variant: "danger",
        label:
          error instanceof UnopenableLinkError
            ? error.message
            : errorMessage(error, "Could not open the file"),
      });
    });
  };
}

/** Full screen, on black, closed with the button or the system back gesture. */
function ImageViewer({ attachment, onClose }: { attachment: Attachment; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View className="flex-1 bg-black">
        <Image
          source={{ uri: attachment.url }}
          style={{ flex: 1 }}
          contentFit="contain"
          accessibilityLabel={attachment.name}
        />
        <View
          className="absolute right-0 left-0 flex-row items-center gap-2 px-3"
          style={{ top: insets.top + 8 }}
        >
          <Button
            isIconOnly
            variant="ghost"
            onPress={onClose}
            className="size-11 rounded-full bg-black/50"
            accessibilityLabel="Close"
          >
            <Icon name="close" color="accent-foreground" />
          </Button>
          <Typography numberOfLines={1} className="flex-1 text-[15px] font-semibold text-white">
            {attachment.name}
          </Typography>
        </View>
      </View>
    </Modal>
  );
}

function ImageAttachment({ attachment }: { attachment: Attachment }) {
  const [isOpen, setIsOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <FileAttachment attachment={attachment} />;
  }
  return (
    <>
      <PressableFeedback
        animation={false}
        onPress={() => setIsOpen(true)}
        className={cn("bg-surface overflow-hidden rounded-[14px]", MEDIA_FRAME)}
        accessibilityRole="imagebutton"
        accessibilityLabel={`Image ${attachment.name}`}
        accessibilityHint="Opens it full screen"
      >
        <Image
          source={{ uri: attachment.url }}
          style={{ width: "100%", height: "100%" }}
          contentFit="cover"
          transition={150}
          recyclingKey={attachment.id}
          onError={() => setFailed(true)}
        />
        <PressableFeedback.Highlight />
      </PressableFeedback>
      {isOpen ? <ImageViewer attachment={attachment} onClose={() => setIsOpen(false)} /> : null}
    </>
  );
}

/**
 * The player only exists once tapped, so a thread full of videos does not create one per
 * row. A texture view, because a surface view ignores the inverted list's transform.
 */
function VideoPlayer({ attachment }: { attachment: Attachment }) {
  const player = useVideoPlayer({ uri: attachment.url }, (created) => {
    created.play();
  });
  return (
    <View className={cn("overflow-hidden rounded-[14px] bg-black", MEDIA_FRAME)}>
      <VideoView
        player={player}
        surfaceType="textureView"
        nativeControls
        fullscreenOptions={{ enable: true }}
        contentFit="contain"
        style={{ width: "100%", height: "100%" }}
        accessibilityLabel={`Video ${attachment.name}`}
      />
    </View>
  );
}

function VideoAttachment({ attachment }: { attachment: Attachment }) {
  const [isPlaying, setIsPlaying] = useState(false);
  if (isPlaying) {
    return <VideoPlayer attachment={attachment} />;
  }
  return (
    <PressableFeedback
      animation={false}
      onPress={() => setIsPlaying(true)}
      className={cn("items-center justify-center gap-2 rounded-[14px] bg-black", MEDIA_FRAME)}
      accessibilityRole="button"
      accessibilityLabel={`Play video ${attachment.name}, ${fileSize(attachment.size)}`}
    >
      <View className="size-14 items-center justify-center rounded-full bg-white/20">
        <Icon name="play-arrow" size={36} color="accent-foreground" />
      </View>
      <Typography numberOfLines={1} className="max-w-[90%] px-3 text-[13px] text-white/80">
        {attachment.name} · {fileSize(attachment.size)}
      </Typography>
      <PressableFeedback.Highlight />
    </PressableFeedback>
  );
}

const FILE_ICONS: Record<Attachment["kind"], IconName> = {
  image: "image",
  video: "movie",
  pdf: "picture-as-pdf",
  file: "insert-drive-file",
};

/** PDFs and other files: icon, name and size; a tap hands the file to the system. */
function FileAttachment({ attachment }: { attachment: Attachment }) {
  const open = useOpenAttachment();
  return (
    <PressableFeedback
      animation={false}
      onPress={() => open(attachment)}
      className="bg-surface-secondary min-w-[220px] flex-row items-center gap-3 rounded-[14px] px-3 py-2.5"
      accessibilityRole="button"
      accessibilityLabel={`${attachment.name}, ${fileSize(attachment.size)}`}
      accessibilityHint="Opens the file"
    >
      <PressableFeedback.Highlight />
      <View className="bg-accent-soft size-10 items-center justify-center rounded-[10px]">
        <Icon name={FILE_ICONS[attachment.kind]} size={22} color="accent" />
      </View>
      <View className="min-w-0 flex-1">
        <Typography numberOfLines={1} className="text-[15px] leading-5 font-semibold">
          {attachment.name}
        </Typography>
        <Typography className="text-muted text-[13px] leading-[18px]">
          {attachment.kind === "pdf" ? "PDF" : "File"} · {fileSize(attachment.size)}
        </Typography>
      </View>
      <Icon name="open-in-new" size={20} color="muted" />
    </PressableFeedback>
  );
}

/** A message's attachment: inline image, tap-to-play video, or a file row. */
export function MessageAttachment({ attachment }: { attachment: Attachment }) {
  switch (attachment.kind) {
    case "image":
      return <ImageAttachment attachment={attachment} />;
    case "video":
      return <VideoAttachment attachment={attachment} />;
    default:
      return <FileAttachment attachment={attachment} />;
  }
}
