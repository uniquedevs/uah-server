import type { ServerContext } from './context';

interface ServerOptions {
  url: string;
  init?: (context?: ServerContext) => Promise<void>;
}

export declare function Server(
  options: ServerOptions,
): (
  target: new (preset?: any) => object,
  context: ClassDecoratorContext,
) => void;

interface ValidationError {
    type: string;
    expected?: unknown;
    value?: unknown;
    path: (string | number)[];
}

interface HttpError extends Error {
    status: number;
    type?: string;
    code?: string;
    errors?: ValidationError[];
    constraint?: string;
    table?: string;
    detail?: string;
}

type OnErrorHandler = (error: HttpError, status: number, context: ServerContext) => void;

export declare function setOnError(fn: OnErrorHandler): void;
