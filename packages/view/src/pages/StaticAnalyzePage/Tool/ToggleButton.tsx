import { useState } from "react";

interface ToggleButtonProps {
  label: React.ReactNode;
  onChange?: (checked: boolean) => void;
  className?: string;
}

export const ToggleButton = ({
  label,
  onChange,
  className = "",
}: ToggleButtonProps) => {
  const [checked, setChecked] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const isChecked = e.target.checked;
    setChecked(isChecked);
    onChange?.(isChecked);
  };

  return (
    <label className={`inline-block cursor-pointer ${className}`}>
      <input
        type="checkbox"
        className="hidden"
        checked={checked}
        onChange={handleChange}
      />
      <span
        className={`
          inline-block px-4 py-2 rounded-lg transition-all duration-300
          border font-semibold
          ${
            checked
              ? "bg-purple-500 border-purple-500 text-white shadow-lg"
              : "border-gray-300 text-purple-500 hover:border-purple-300"
          }
        `}
      >
        {label}
      </span>
    </label>
  );
};

export default ToggleButton;
