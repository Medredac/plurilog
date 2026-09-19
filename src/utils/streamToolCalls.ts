/**
 * OpenAI-Compatible Streaming Tool Call Parser
 *
 * Accumulates and finalizes streaming tool calls from `delta.tool_calls` chunks.
 *
 * NOTE: Inert utility — not currently imported or consumed by runtime routes.
 */

export interface StreamingToolCallDelta {
  index: number;
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

export interface AccumulatedToolCall {
  index: number;
  id: string;
  type: string;
  function: {
    name: string;
    arguments: string;
  };
}

export interface FinalizedToolCall<T = Record<string, unknown>> {
  index: number;
  id: string;
  type: string;
  name: string;
  arguments: T;
  rawArguments: string;
}

/**
 * Merges incoming streaming tool-call deltas into an accumulated array by tool-call index.
 * Concatenates argument strings in stream order without parsing JSON during streaming.
 */
export function mergeStreamingToolCalls(
  accumulated: AccumulatedToolCall[],
  incomingDeltas?: StreamingToolCallDelta[] | null
): AccumulatedToolCall[] {
  if (!incomingDeltas || !Array.isArray(incomingDeltas) || incomingDeltas.length === 0) {
    return accumulated;
  }

  for (const delta of incomingDeltas) {
    if (typeof delta?.index !== 'number' || delta.index < 0) {
      continue;
    }

    let target = accumulated.find((c) => c.index === delta.index);

    if (!target) {
      target = {
        index: delta.index,
        id: delta.id || '',
        type: delta.type || 'function',
        function: {
          name: delta.function?.name || '',
          arguments: delta.function?.arguments || '',
        },
      };
      accumulated.push(target);
    } else {
      if (delta.id && !target.id) {
        target.id = delta.id;
      }
      if (delta.type && !target.type) {
        target.type = delta.type;
      }
      if (delta.function?.name) {
        target.function.name += delta.function.name;
      }
      if (delta.function?.arguments) {
        target.function.arguments += delta.function.arguments;
      }
    }
  }

  return accumulated;
}

/**
 * Finalizes and parses a single accumulated tool call, validating the function name
 * and parsing the accumulated JSON arguments.
 * Throws a controlled, descriptive error if arguments JSON is malformed.
 */
export function finalizeToolCall<T = Record<string, unknown>>(
  toolCall: AccumulatedToolCall
): FinalizedToolCall<T> {
  if (!toolCall) {
    throw new Error('Cannot finalize null or undefined tool call');
  }

  const callType = toolCall.type || 'function';
  if (callType !== 'function') {
    throw new Error(`Unsupported tool call type "${toolCall.type}" at index ${toolCall.index}`);
  }

  const name = toolCall.function?.name?.trim();
  if (!name) {
    throw new Error(`Tool call at index ${toolCall.index} is missing a function name`);
  }

  const rawArgs = toolCall.function?.arguments ?? '';
  const trimmedArgs = rawArgs.trim();

  let parsedArguments: T;
  if (!trimmedArgs) {
    parsedArguments = {} as T;
  } else {
    try {
      parsedArguments = JSON.parse(trimmedArgs) as T;
      if (
        typeof parsedArguments !== 'object' ||
        parsedArguments === null ||
        Array.isArray(parsedArguments)
      ) {
        throw new Error('Tool call arguments must be a JSON object');
      }
    } catch (err: any) {
      if (err?.message === 'Tool call arguments must be a JSON object') {
        throw err;
      }
      throw new Error(
        `Failed to parse tool call arguments for function "${name}" at index ${toolCall.index}: ${err?.message || 'Invalid JSON'}`
      );
    }
  }

  return {
    index: toolCall.index,
    id: toolCall.id,
    type: 'function',
    name,
    arguments: parsedArguments,
    rawArguments: rawArgs,
  };
}

/**
 * Finalizes all accumulated tool calls in index order.
 */
export function finalizeAllToolCalls(
  accumulated: AccumulatedToolCall[]
): FinalizedToolCall[] {
  if (!Array.isArray(accumulated) || accumulated.length === 0) {
    return [];
  }

  const sorted = [...accumulated].sort((a, b) => a.index - b.index);
  return sorted.map((call) => finalizeToolCall(call));
}
