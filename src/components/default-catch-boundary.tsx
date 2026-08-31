import type { ErrorComponentProps } from "@tanstack/react-router";

import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { Icon } from "@astryxdesign/core/Icon";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { rootRouteId, useMatch, useRouter } from "@tanstack/react-router";
import { ArrowLeft, Home, Mail, RefreshCw } from "lucide-react";

export function DefaultCatchBoundary({ error }: ErrorComponentProps) {
  const router = useRouter();
  const isRoot = useMatch({
    strict: false,
    select: (state) => state.id === rootRouteId,
  });

  console.error(error);

  const errorMessage = error.message || "An unexpected error occurred";
  const errorStack = error.stack ?? "";

  const handleReportError = () => {
    const subject = encodeURIComponent("Error Report");
    const body = encodeURIComponent(
      `An error occurred in: application:\n\nError: ${errorMessage}\n\nStack Trace:\n${errorStack}\n\nPlease describe what you were doing when this error occurred:`,
    );
    const url = `mailto:support@example.com?subject=${subject}&body=${body}`;
    window.location.href = url;
  };

  return (
    <VStack minHeight="60vh" hAlign="center" vAlign="center" padding={4}>
      <VStack gap={4} width="100%" maxWidth={640}>
        <Banner
          status="error"
          title="Something went wrong"
          description={errorMessage}
        >
          {errorStack.length > 0 && (
            <CodeBlock
              code={errorStack}
              title="Stack trace"
              hasLanguageLabel={false}
              size="sm"
              width="100%"
              maxHeight={160}
              container="section"
              isWrapped
            />
          )}
        </Banner>
        <HStack gap={2} wrap="wrap">
          <Button
            label="Try Again"
            variant="primary"
            icon={<Icon icon={RefreshCw} color="inherit" />}
            onClick={() => {
              void router.invalidate();
            }}
          />
          {isRoot ? (
            <Button
              label="Go to Home"
              icon={<Icon icon={Home} color="inherit" />}
              onClick={() => {
                void router.navigate({ to: "/" });
              }}
            />
          ) : (
            <Button
              label="Go Back"
              icon={<Icon icon={ArrowLeft} color="inherit" />}
              onClick={() => {
                window.history.back();
              }}
            />
          )}
          <Button
            label="Report Error"
            variant="ghost"
            icon={<Icon icon={Mail} color="inherit" />}
            onClick={handleReportError}
          />
        </HStack>
        <Text type="supporting" color="secondary">
          If this error persists, please report it to our support team.
        </Text>
      </VStack>
    </VStack>
  );
}
