import { type NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

export interface ValidatorOptions {
  errorStatus?: number;
  omitNotShapeField?: boolean;
  stopOnFirstError?: boolean;
}

type InferInput<TSchema extends z.ZodTypeAny> = z.input<TSchema>;
type InferOutput<TSchema extends z.ZodTypeAny> = z.output<TSchema>;
type MaybePromise<T> = T | Promise<T>;

const getRequestInput = async (req: Request): Promise<Record<string, unknown>> => {
  const method = req.method?.toUpperCase?.() ?? 'GET';
  if (method === 'GET' || method === 'HEAD') {
    return Object.fromEntries(new URL(req.url).searchParams.entries());
  }

  const contentType = req.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      return (await req.json()) as any;
    } catch {
      return {};
    }
  }

  try {
    return (await (req as any).json?.()) as any;
  } catch {
    return Object.fromEntries(new URL(req.url).searchParams.entries());
  }
};

const applyOptionsToSchema = <TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  options: ValidatorOptions,
): z.ZodTypeAny => {
  if (!options.omitNotShapeField) return schema;
  if (schema instanceof z.ZodObject) return schema.strip();
  return schema;
};

export const createValidator =
  (options: ValidatorOptions = {}) =>
  <TSchema extends z.ZodTypeAny>(schema: TSchema) => {
    const errorStatus = options.errorStatus ?? 422;
    const effectiveSchema = applyOptionsToSchema(schema, options) as z.ZodType<
      InferOutput<TSchema>
    >;

    return <TReq extends NextRequest, TContext>(
        handler: (
          req: TReq,
          context: TContext,
          data: InferOutput<TSchema>,
        ) => MaybePromise<Response>,
      ) =>
      async (req: TReq, context?: TContext) => {
        const input = (await getRequestInput(req)) as InferInput<TSchema>;
        const result = effectiveSchema.safeParse(input);

        if (!result.success) {
          const issues = options.stopOnFirstError
            ? result.error.issues.slice(0, 1)
            : result.error.issues;
          return NextResponse.json({ error: 'Invalid request', issues }, { status: errorStatus });
        }

        return handler(req, context as TContext, result.data);
      };
  };

export const zodValidator = createValidator({
  errorStatus: 422,
  omitNotShapeField: true,
  stopOnFirstError: true,
});
