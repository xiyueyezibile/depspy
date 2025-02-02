const MyButton = ({ children, onClick }) => {
  return (
    <div
      onClick={onClick}
      className="w-40 h-15 flex items-center justify-center border-solid rounded-3 cursor-pointer"
    >
      {children}
    </div>
  );
};

export default MyButton;
