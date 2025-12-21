import classNames from "classnames";
import { type FC, type HTMLProps, memo, type PropsWithChildren } from "react";
import styles from "./index.module.css";

export const MediaButton: FC<PropsWithChildren<HTMLProps<HTMLButtonElement>>> =
	memo(({ className, children, type, ...rest }) => {
		return (
			<button
				className={classNames(styles.mediaButton, className)}
				type="button"
				{...rest}
			>
				{children}
			</button>
		);
	});
