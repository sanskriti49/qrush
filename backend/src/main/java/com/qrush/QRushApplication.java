package com.qrush;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@EnableScheduling
@SpringBootApplication
public class QRushApplication {

	public static void main(String[] args) {
		SpringApplication.run(QRushApplication.class, args);
	}

}
