import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { HStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";

interface ConfirmDialogProps {
  title: string;
  description: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: () => void;
}

/** A yes/no question before a step that discards a note list. */
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  onClose,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog isOpen purpose="form" width={400} onOpenChange={onClose}>
      <Layout
        header={<DialogHeader title={title} onOpenChange={onClose} />}
        content={
          <LayoutContent>
            <Text type="supporting" color="secondary">
              {description}
            </Text>
          </LayoutContent>
        }
        footer={
          <LayoutFooter>
            <HStack gap={2} hAlign="end">
              <Button label="Cancel" variant="secondary" onClick={onClose} />
              <Button
                label={confirmLabel}
                variant="primary"
                onClick={onConfirm}
              />
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}
