"use client";

import { useState, type FormEvent } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Loader2 } from "lucide-react";
import type { FtuUIMessage } from "@/lib/agent"; // type-only: erased, never loads the server module
import { BrandCard } from "@/components/brand-card";
import { ProgressSteps } from "@/components/progress-steps";
import { useSession } from "@/components/session-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Message, MessageContent, MessageGroup } from "@/components/ui/message";

// The session id is not baked in here: it is sent per call (`{ body: { sessionId } }`),
// so the transport never goes stale.
const transport = new DefaultChatTransport({ api: "/api/chat" });

// "https://www.starterbakery.com/menu" -> "starterbakery.com"
function displayDomain(input: string): string {
  return input
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
    .replace(/^www\./i, "")
    .split(/[/?#]/)[0];
}

export default function Home() {
  const { sessionId, error: sessionError, retry: retrySession } = useSession();

  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [noWebsite, setNoWebsite] = useState(false);
  // Set on URL submit so "Reading {domain}…" shows before the tool part streams in.
  const [pendingDomain, setPendingDomain] = useState<string | null>(null);

  const { messages, sendMessage, status, error, regenerate, stop, clearError, setMessages } =
    useChat<FtuUIMessage>({ transport });

  const busy = status === "submitted" || status === "streaming";
  const canSubmit = !!sessionId && !busy;

  // Back to the empty form. Keeps the same session: researching a new site upserts over the saved profile.
  function startOver() {
    stop(); // abort any in-flight request first
    clearError();
    setMessages([]);
    setNoWebsite(false);
    setPendingDomain(null);
    setUrl("");
    setDescription("");
  }

  function submitUrl(e: FormEvent) {
    e.preventDefault();
    const value = url.trim();
    if (!value || !canSubmit) return;
    setPendingDomain(displayDomain(value));
    sendMessage({ text: value }, { body: { sessionId } });
    setUrl("");
  }

  function submitDescription(e: FormEvent) {
    e.preventDefault();
    const value = description.trim();
    if (!value || !canSubmit) return;
    setPendingDomain(null);
    sendMessage({ text: value }, { body: { sessionId } });
    setDescription("");
  }

  // The fallback box shows when the last assistant turn's researchSite call failed.
  const last = messages[messages.length - 1];
  const researchFailed =
    status === "ready" &&
    last?.role === "assistant" &&
    last.parts.some((p) => p.type === "tool-researchSite" && p.state === "output-available" && !p.output.ok);

  const started = messages.length > 0;
  const showDescribeBox = noWebsite || researchFailed;

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-10 px-4 py-8 sm:py-12">
      <ProgressSteps current={0} />

      {sessionError && (
        <div role="alert" className="flex flex-col items-start gap-3 text-sm">
          <p>We couldn&apos;t start your session.</p>
          <Button type="button" onClick={retrySession} className="h-10 rounded-full px-5">
            Try again
          </Button>
        </div>
      )}

      {!started && (
        <section className="flex flex-col gap-6">
          <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">
            {noWebsite ? "Tell us about your business" : "What’s your website?"}
          </h1>

          {!noWebsite ? (
            <>
              <form onSubmit={submitUrl} className="flex flex-col gap-3 sm:flex-row">
                <Label htmlFor="site-url" className="sr-only">
                  Website URL
                </Label>
                <Input
                  id="site-url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="starterbakery.com"
                  inputMode="url"
                  autoComplete="url"
                  autoCapitalize="none"
                  spellCheck={false}
                  className="h-11 flex-1 rounded-full bg-white px-4 text-base"
                />
                <Button
                  type="submit"
                  disabled={!canSubmit || !url.trim()}
                  className="h-11 rounded-full px-6 text-base"
                >
                  Continue
                </Button>
              </form>
              <button
                type="button"
                onClick={() => setNoWebsite(true)}
                className="self-start rounded text-sm underline underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                I don&apos;t have a website yet
              </button>
            </>
          ) : (
            <DescribeForm
              value={description}
              onChange={setDescription}
              onSubmit={submitDescription}
              disabled={!canSubmit}
            />
          )}
        </section>
      )}

      {started && (
        <section aria-label="Conversation" aria-live="polite" className="flex flex-col gap-6">
          <MessageGroup className="gap-6">
            {messages.map((m, i) => (
              <Message key={m.id} align={m.role === "user" ? "end" : "start"}>
                <MessageContent>
                  {m.role === "user" ? (
                    <UserText message={m} />
                  ) : (
                    <AssistantParts
                      message={m}
                      pendingDomain={i === messages.length - 1 ? pendingDomain : null}
                    />
                  )}
                </MessageContent>
              </Message>
            ))}

            {/* Before the assistant message exists (or while it has no visible parts) */}
            {status === "submitted" && (
              <Message>
                <MessageContent>
                  <Working label={pendingDomain ? `Reading ${pendingDomain}…` : "Thinking…"} />
                </MessageContent>
              </Message>
            )}
          </MessageGroup>

          {error && (
            <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl border border-foreground/15 bg-white p-4 text-sm">
              <p>{error.message || "Something went wrong. Please try again."}</p>
              <Button type="button" onClick={() => regenerate({ body: { sessionId } })} className="h-10 rounded-full px-5">
                Retry
              </Button>
            </div>
          )}

          {showDescribeBox && !error && (
            <DescribeForm
              value={description}
              onChange={setDescription}
              onSubmit={submitDescription}
              disabled={!canSubmit}
            />
          )}

          <button
            type="button"
            onClick={startOver}
            className="self-start rounded text-sm underline underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Use a different website
          </button>
        </section>
      )}
    </main>
  );
}

function DescribeForm(props: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (e: FormEvent) => void;
  disabled: boolean;
}) {
  return (
    <form onSubmit={props.onSubmit} className="flex flex-col gap-3 sm:flex-row">
      <Label htmlFor="business-description" className="sr-only">
        Describe your business in a sentence
      </Label>
      <Input
        id="business-description"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder="Describe your business in a sentence"
        className="h-11 flex-1 rounded-full bg-white px-4 text-base"
      />
      <Button
        type="submit"
        disabled={props.disabled || !props.value.trim()}
        className="h-11 rounded-full px-6 text-base"
      >
        Continue
      </Button>
    </form>
  );
}

function Working({ label }: { label: string }) {
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-foreground/80">
      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      {label}
    </p>
  );
}

function UserText({ message }: { message: FtuUIMessage }) {
  const text = message.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
  return <p className="rounded-2xl bg-foreground px-4 py-2 text-background">{text}</p>;
}

function AssistantParts({ message, pendingDomain }: { message: FtuUIMessage; pendingDomain: string | null }) {
  return (
    <>
      {message.parts.map((part, i) => {
        switch (part.type) {
          case "text":
            return part.text ? <p key={i} className="text-base leading-relaxed">{part.text}</p> : null;

          case "tool-researchSite": {
            if (part.state === "input-streaming" || part.state === "input-available") {
              const domain = displayDomain(part.input?.url ?? "") || pendingDomain || "your site";
              return <Working key={i} label={`Reading ${domain}…`} />;
            }
            if (part.state === "output-available") {
              return part.output.ok ? (
                <BrandCard key={i} brand={part.output.brand} domain={part.output.domain} />
              ) : (
                <p key={i} className="text-base">
                  We couldn&apos;t read your site.
                </p>
              );
            }
            // output-error: the tool never throws, but handle it so the page never goes blank
            return (
              <p key={i} className="text-base">
                We couldn&apos;t read your site.
              </p>
            );
          }

          default:
            return null; // reasoning, step markers, etc.
        }
      })}
    </>
  );
}
