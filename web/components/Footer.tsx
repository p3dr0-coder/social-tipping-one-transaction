import { nearConfig } from "~~/near.config";
import { SwitchTheme } from "~~/components/SwitchTheme";

/**
 * Site footer
 */
export const Footer = () => {
  return (
    <div className="min-h-0 py-5 px-1 mb-11 lg:mb-0">
      <div>
        <div className="fixed flex justify-between items-center w-full z-10 p-4 bottom-0 left-0 pointer-events-none">
          <div className="flex flex-col md:flex-row gap-2 pointer-events-auto" />
          <SwitchTheme className="pointer-events-auto" />
        </div>
      </div>
      <div className="w-full">
        <div className="flex justify-center items-center gap-2 text-[10px] uppercase tracking-[0.2em] opacity-30 font-bold py-4">
          <span>philia</span>
          <span>•</span>
          <span>{nearConfig.network}</span>
        </div>
      </div>
    </div>
  );
};
