export interface ParsedPlanDocument {
  task_hints: string[];
  design_doc_path: string | null;
  task_docs_by_hint: Record<string, string[]>;
}

const TASK_HEADING_PATTERN = /^### (Task \d+: .+)$/u;
const DESIGN_DOC_PATTERN = /^\*\*Design Doc:\*\*\s*(.*)$/iu;
const TASK_DOCS_PATTERN = /^\*\*Task docs:\*\*\s*(.*)$/iu;
const BULLET_PATTERN = /^\s*-\s+(.*)$/u;

export function parsePlanDocument(markdown: string): ParsedPlanDocument {
  const taskHints: string[] = [];
  const taskDocsByHint: Record<string, string[]> = {};
  let designDocPath: string | null = null;
  let currentTaskHint: string | null = null;
  let collectingTaskDocsFor: string | null = null;

  for (const rawLine of markdown.split(/\r?\n/u)) {
    const line = rawLine.trim();
    const taskHeadingMatch = TASK_HEADING_PATTERN.exec(line);

    if (taskHeadingMatch) {
      currentTaskHint = taskHeadingMatch[1];
      collectingTaskDocsFor = null;
      taskHints.push(currentTaskHint);
      taskDocsByHint[currentTaskHint] ??= [];
      continue;
    }

    if (designDocPath === null) {
      const designDocMatch = DESIGN_DOC_PATTERN.exec(line);
      if (designDocMatch) {
        designDocPath = normalizePathReference(designDocMatch[1]);
        continue;
      }
    }

    const taskDocsMatch = TASK_DOCS_PATTERN.exec(line);
    if (taskDocsMatch) {
      if (!currentTaskHint) {
        continue;
      }

      taskDocsByHint[currentTaskHint] ??= [];
      const inlinePath = normalizePathReference(taskDocsMatch[1]);
      if (inlinePath) {
        pushUnique(taskDocsByHint[currentTaskHint], inlinePath);
      }
      collectingTaskDocsFor = currentTaskHint;
      continue;
    }

    if (!collectingTaskDocsFor) {
      continue;
    }

    const bulletMatch = BULLET_PATTERN.exec(rawLine);
    if (bulletMatch) {
      const taskDocPath = normalizePathReference(bulletMatch[1]);
      if (taskDocPath) {
        pushUnique(taskDocsByHint[collectingTaskDocsFor], taskDocPath);
      }
      continue;
    }

    if (!line) {
      continue;
    }

    collectingTaskDocsFor = null;
  }

  return {
    task_hints: taskHints,
    design_doc_path: designDocPath,
    task_docs_by_hint: taskDocsByHint,
  };
}

function normalizePathReference(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const markdownLinkDestination = extractMarkdownLinkDestination(trimmed);
  if (markdownLinkDestination) {
    return markdownLinkDestination;
  }

  const backtickMatch = /`([^`]+)`/u.exec(trimmed);
  if (backtickMatch?.[1]) {
    return backtickMatch[1].trim() || null;
  }

  return trimmed;
}

function extractMarkdownLinkDestination(value: string): string | null {
  const markdownLinkMatch = /\[[^\]]+\]\((.+)\)/u.exec(value);
  const destinationAndTitle = markdownLinkMatch?.[1]?.trim();

  if (!destinationAndTitle) {
    return null;
  }

  const angleBracketDestinationMatch = /^<([^>]+)>/u.exec(destinationAndTitle);
  if (angleBracketDestinationMatch?.[1]) {
    return angleBracketDestinationMatch[1].trim() || null;
  }

  const plainDestinationMatch = /^([^\s]+)(?:\s+.+)?$/u.exec(destinationAndTitle);
  if (plainDestinationMatch?.[1]) {
    return plainDestinationMatch[1].trim() || null;
  }

  return null;
}

function pushUnique(values: string[], value: string): void {
  if (!values.includes(value)) {
    values.push(value);
  }
}
