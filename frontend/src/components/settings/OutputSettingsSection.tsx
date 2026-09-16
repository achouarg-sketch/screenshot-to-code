import { useEffect } from "react";
import { Stack } from "../../lib/stacks";
import DesignSystemSelector, {
  DesignSystemSelectorProps,
} from "./DesignSystemSelector";

interface Props {
  stack: Stack | undefined;
  setStack: (config: Stack) => void;
  label?: string;
  shouldDisableUpdates?: boolean;
  designSystem?: DesignSystemSelectorProps;
  inline?: boolean;
}

function OutputSettingsSection({
  stack,
  setStack,
  label = "Output:",
  designSystem,
  inline = false,
}: Props) {
  useEffect(() => {
    if (stack !== Stack.HTML_CSS) {
      setStack(Stack.HTML_CSS);
    }
  }, [setStack, stack]);

  const wordpressOutput = (
    <div
      className="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
      data-testid="wordpress-output-mode"
    >
      <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500" />
      WordPress HTML Widget
    </div>
  );

  if (inline) {
    return (
      <div className="flex items-center gap-2">
        {wordpressOutput}
        {designSystem && <DesignSystemSelector {...designSystem} compact />}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-y-2 justify-between text-sm">
      <div className="grid grid-cols-3 items-center gap-4">
        <span>{label}</span>
        <div className="col-span-2">{wordpressOutput}</div>
      </div>
      {designSystem && <DesignSystemSelector {...designSystem} />}
    </div>
  );
}

export default OutputSettingsSection;
