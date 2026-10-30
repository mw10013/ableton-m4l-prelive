import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import { VStack } from "@astryxdesign/core/Stack";
import { useRouter } from "@tanstack/react-router";
import { ArrowLeft, FileQuestion, Home } from "lucide-react";

export function NotFound() {
  const router = useRouter();
  return (
    <VStack minHeight="60vh" hAlign="center" vAlign="center" padding={4}>
      <EmptyState
        icon={<Icon icon={FileQuestion} size="lg" color="secondary" />}
        title="Page Not Found"
        description="The page you're looking for doesn't exist or has been moved. Try checking the URL."
        actions={
          <>
            <Button
              label="Go Back"
              variant="primary"
              icon={<Icon icon={ArrowLeft} color="inherit" />}
              onClick={() => {
                window.history.back();
              }}
            />
            <Button
              label="Home"
              icon={<Icon icon={Home} color="inherit" />}
              onClick={() => {
                void router.navigate({ to: "/" });
              }}
            />
          </>
        }
      />
    </VStack>
  );
}
