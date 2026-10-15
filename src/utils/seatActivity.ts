import type { SeatStatus } from '@/types/chat';

// Labels are plain text from observed tool arguments, never URLs or credentials.
export function activityText(value: unknown, max = 100): string {
  if (typeof value !== 'string') return '';
  const text = value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}
export function activityFilename(value: unknown): string {
  if (typeof value !== 'string') return '';
  return activityText(value.split(/[\\/]/).pop()?.split(/[?#]/)[0], 80);
}
export function videoActivity(args: Record<string, unknown>): { activity: SeatStatus; label: string } {
  const filename = activityFilename(args.filename);
  const source = filename ? `“${filename}”` : args.youtube_url ? 'YouTube video' : 'video';
  const start = args.start_seconds;
  const end = args.end_seconds;
  const time = (n: number) => `${Math.floor(n / 60).toString().padStart(2, '0')}:${Math.floor(n % 60).toString().padStart(2, '0')}`;
  // Only uploaded-video ranges are passed to the actual segment processor.
  const range = filename && typeof start === 'number' && Number.isFinite(start) && start >= 0
    ? typeof end === 'number' && Number.isFinite(end) && end > start ? ` · ${time(start)}–${time(end)}` : ` · from ${time(start)}` : '';
  return { activity: 'analyzing_video', label: `Examining ${source}${range}…` };
}

export function buildAgenticSeatActivity(
  toolName: string,
  rawArgs: unknown
): { activity: SeatStatus; label: string } | null {
  const args =
    rawArgs && typeof rawArgs === 'object'
      ? (rawArgs as Record<string, unknown>)
      : {};

  const speaker =
    typeof args.speaker === 'string' ? args.speaker.toLowerCase() : 'any';
  const speakerLabel =
    speaker === 'chatgpt'
      ? 'ChatGPT'
      : speaker === 'claude'
        ? 'Claude'
        : speaker === 'gemini'
          ? 'Gemini'
          : speaker === 'user'
            ? 'you'
            : null;
  const speakerPossessive =
    speakerLabel === 'you'
      ? 'your'
      : speakerLabel
        ? `${speakerLabel}’s`
        : null;

  const query = activityText(args.query, 90);
  const querySuffix = query ? `: “${query}”` : '';
  const rawFilename =
    typeof args.filename === 'string' ? args.filename.trim() : '';
  const filename = activityFilename(rawFilename);

  switch (toolName) {
    case 'search_conversation_memory':
      return {
        activity: 'searching_conversation',
        label: speakerPossessive
          ? `Searching ${speakerPossessive} earlier messages${querySuffix}…`
          : `Searching earlier messages${querySuffix}…`,
      };

    case 'find_conversation_event': {
      const mode =
        args.mode === 'speaker_boundary' ? 'speaker_boundary' : 'topic';
      const occurrence = args.occurrence === 'last' ? 'last' : 'first';

      if (mode === 'speaker_boundary' && speakerPossessive) {
        return {
          activity: 'checking_chronology',
          label:
            speakerLabel === 'you'
              ? `Finding your ${occurrence === 'last' ? 'latest' : 'earliest'} message…`
              : `Finding ${speakerPossessive} ${occurrence === 'last' ? 'latest' : 'earliest'} reply…`,
        };
      }

      return {
        activity: 'checking_chronology',
        label:
          occurrence === 'last'
            ? `Finding the latest mention${querySuffix}…`
            : `Finding the first mention${querySuffix}…`,
      };
    }

    case 'navigate_conversation_evidence': {
      const direction = args.direction === 'after' ? 'after' : 'before';
      return {
        activity: 'checking_chronology',
        label: speakerPossessive
          ? speakerLabel === 'you'
            ? `Checking your ${direction === 'after' ? 'next' : 'previous'} message…`
            : `Checking ${speakerPossessive} ${direction === 'after' ? 'next' : 'previous'} reply…`
          : `Checking what came immediately ${direction}…`,
      };
    }

    case 'expand_grounded_evidence':
    case 'expand_conversation_evidence':
      return {
        activity: 'reading_context',
        label: 'Reading more context…',
      };

    case 'get_recent_conversation':
      return {
        activity: 'reading_context',
        label: speakerPossessive
          ? speakerLabel === 'you'
            ? 'Reviewing your recent messages…'
            : `Reviewing ${speakerPossessive} recent replies…`
          : 'Reviewing recent conversation…',
      };

    case 'search_document_evidence':
      return {
        activity: 'searching_documents',
        label: filename
          ? `Searching “${filename}”${querySuffix}…`
          : `Searching earlier documents${querySuffix}…`,
      };

    case 'inspect_video':
      return { activity: 'analyzing_video', label: filename ? `Opening “${filename}”…` : 'Opening YouTube video…' };
    case 'request_evidence': {
      const resourceType =
        args.resource_type === 'image'
          ? 'image'
          : args.resource_type === 'document'
            ? 'document'
            : 'source';
      return {
        activity: 'locating_evidence',
        label: filename
          ? `Opening “${filename}”…`
          : `Locating the referenced ${resourceType}…`,
      };
    }

    default:
      return null;
  }
}


export function documentActivityLabel(activity: string, title: unknown, format: string): string {
  const name = activityText(title) || 'document';
  const action = activity === 'generating_image' ? 'Creating illustrations for' : activity === 'editing_image' ? 'Editing illustrations for' : activity === 'checking_documents' ? 'Checking layout of' : activity === 'saving_file' ? 'Saving' : activity.startsWith('editing_') ? 'Editing' : 'Creating';
  return `${action} “${name}” (${format === 'pdf' ? 'PDF' : 'Word'})…`;
}
